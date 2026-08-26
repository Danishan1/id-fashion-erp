import { logger } from "@/core/logging/logger";

export type BusinessRuleErrorCode =
  | "INSUFFICIENT_FG_STOCK"
  | "INSUFFICIENT_RAW_MATERIAL_STOCK"
  | "UNBALANCED_JOURNAL"
  | "POSTED_INVOICE_LOCKED"
  | "REFERENCED_RECORD_IN_USE"
  | "DUPLICATE_DOC_NUMBER"
  | "PERMISSION_DENIED"
  | "SELF_APPROVAL_NOT_ALLOWED"
  | "INVALID_STATE_TRANSITION"
  | "OVER_RECEIPT_NOT_ALLOWED"
  | "OVER_REVERSAL_NOT_ALLOWED"
  | "OVER_ISSUE_NOT_ALLOWED"
  | "DUPLICATE_MATERIAL_REQUEST_EXISTS"
  | "UOM_CONVERSION_UNAVAILABLE"
  | "OVER_PRODUCTION_NOT_ALLOWED"
  | "LOT_GENEALOGY_INVALID"
  | "INSUFFICIENT_STOCK_FOR_MOVEMENT"
  | "DUPLICATE_LEAD_EXISTS"
  | "DUPLICATE_CUSTOMER_EXISTS"
  | "LEAVE_BALANCE_EXCEEDED"
  | "AD_INTEGRATION_NOT_CONFIGURED"
  | "AD_SYNC_FAILED"
  | "OVER_INVOICE_NOT_ALLOWED"
  | "OVER_PAYMENT_NOT_ALLOWED"
  | "DUPLICATE_EMAIL_EXISTS"
  | "VALIDATION_ERROR"
  | "NOT_FOUND";

const HTTP_STATUS_BY_CODE: Record<BusinessRuleErrorCode, number> = {
  INSUFFICIENT_FG_STOCK: 409,
  INSUFFICIENT_RAW_MATERIAL_STOCK: 409,
  UNBALANCED_JOURNAL: 422,
  POSTED_INVOICE_LOCKED: 409,
  REFERENCED_RECORD_IN_USE: 409,
  DUPLICATE_DOC_NUMBER: 409,
  PERMISSION_DENIED: 403,
  SELF_APPROVAL_NOT_ALLOWED: 403,
  INVALID_STATE_TRANSITION: 409,
  OVER_RECEIPT_NOT_ALLOWED: 409,
  OVER_REVERSAL_NOT_ALLOWED: 409,
  OVER_ISSUE_NOT_ALLOWED: 409,
  DUPLICATE_MATERIAL_REQUEST_EXISTS: 409,
  UOM_CONVERSION_UNAVAILABLE: 409,
  OVER_PRODUCTION_NOT_ALLOWED: 409,
  LOT_GENEALOGY_INVALID: 409,
  INSUFFICIENT_STOCK_FOR_MOVEMENT: 409,
  DUPLICATE_LEAD_EXISTS: 409,
  DUPLICATE_CUSTOMER_EXISTS: 409,
  LEAVE_BALANCE_EXCEEDED: 409,
  AD_INTEGRATION_NOT_CONFIGURED: 400,
  AD_SYNC_FAILED: 502,
  OVER_INVOICE_NOT_ALLOWED: 409,
  OVER_PAYMENT_NOT_ALLOWED: 409,
  DUPLICATE_EMAIL_EXISTS: 409,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
};

/**
 * Every user-facing business-rule violation across modules should throw this
 * (or a helper that constructs one) rather than a generic Error, so route
 * handlers can map it to the structured `{ error: { code, message, details } }`
 * response shape instead of a bare 500.
 */
export class BusinessRuleError extends Error {
  readonly code: BusinessRuleErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: BusinessRuleErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BusinessRuleError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.details = details;
  }

  toResponseBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details ?? null,
      },
    };
  }
}

/**
 * Distinguishes which unique constraint a P2002 actually violated, by
 * column name — needed wherever a table has more than one unique constraint
 * that can raise P2002 (e.g. Sales/Purchase Invoice's pre-existing partial
 * unique index alongside CF-5's new idempotencyKey constraint), so a
 * catch block doesn't misattribute one collision as the other.
 *
 * Checks two possible shapes, confirmed by directly triggering both real
 * constraints in this project's own dev database rather than assumed from
 * generic Prisma docs: `meta.target` (the shape some Prisma configurations
 * use) and `meta.driverAdapterError.cause.constraint.fields` (the actual
 * shape produced by this project's `@prisma/adapter-pg` driver adapter —
 * `meta.target` is NOT present at all under this adapter, confirmed live).
 */
export function isUniqueConstraintViolationOnColumn(error: unknown, columnName: string): boolean {
  if (!(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002")) {
    return false;
  }
  const meta = (error as { meta?: unknown }).meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;
  if (Array.isArray(meta?.target) && meta.target.includes(columnName)) return true;
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields;
  return Array.isArray(fields) && fields.includes(columnName);
}

export function toErrorResponse(error: unknown): { status: number; body: unknown } {
  if (error instanceof BusinessRuleError) {
    return { status: error.httpStatus, body: error.toResponseBody() };
  }

  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    const zodError = error as { issues: { path: (string | number)[]; message: string }[] };
    const firstIssue = zodError.issues[0];
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid input.",
          details: { issues: zodError.issues },
        },
      },
    };
  }

  // Prisma errors that every `findFirst`-then-`create` or bare `:id` lookup
  // across this codebase can throw, previously falling through to a raw 500
  // in every single module rather than a clean, expected response:
  //  - P2007 "Data validation error" — a malformed (non-UUID) id/filter value
  //    reaching a `@db.Uuid` column, e.g. a bad :id route param.
  //  - P2002 "Unique constraint failed" — a genuine TOCTOU race between two
  //    concurrent creates that both passed an app-layer duplicate check
  //    before either committed; the DB's own unique constraint is what
  //    actually prevents the duplicate, this just gives it a clean message.
  if (error && typeof error === "object" && "code" in error) {
    const prismaError = error as { code?: string; meta?: { target?: string[] | string } };
    if (prismaError.code === "P2007") {
      return {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "One or more values in this request are not in the expected format.",
            details: null,
          },
        },
      };
    }
    if (prismaError.code === "P2002") {
      const target = prismaError.meta?.target;
      const field = Array.isArray(target) ? target.join(", ") : target;
      return {
        status: 409,
        body: {
          error: {
            code: "DUPLICATE_DOC_NUMBER",
            message: field ? `A record with this ${field} already exists.` : "A record with these values already exists.",
            details: null,
          },
        },
      };
    }
  }

  logger.error("Unhandled API error", { error });
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again or contact support if the problem persists.",
        details: null,
      },
    },
  };
}

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
  | "PRODUCTION_ORDER_EXISTS"
  | "LOT_GENEALOGY_INVALID"
  | "INSUFFICIENT_STOCK_FOR_MOVEMENT"
  | "DUPLICATE_LEAD_EXISTS"
  // CRM (2026-10-01): a configured "warn" duplicate rule matched — the client
  // may retry with explicit confirmation (details.matches lists the records).
  | "CRM_POSSIBLE_DUPLICATE"
  // CRM: creating this contact/company would duplicate an existing record.
  | "CRM_DUPLICATE_RECORD"
  // Optimistic locking: the record changed since the caller loaded it.
  | "RECORD_VERSION_CONFLICT"
  | "DUPLICATE_CUSTOMER_EXISTS"
  | "LEAVE_BALANCE_EXCEEDED"
  | "AD_INTEGRATION_NOT_CONFIGURED"
  | "AD_SYNC_FAILED"
  | "OVER_INVOICE_NOT_ALLOWED"
  | "OVER_PAYMENT_NOT_ALLOWED"
  | "OVER_CREDIT_NOTE_NOT_ALLOWED"
  | "DUPLICATE_EMAIL_EXISTS"
  | "DUPLICATE_TAX_REGISTRATION_NO"
  | "PRODUCTION_STAGE_ACCESS_DENIED"
  | "BRANCH_ACCESS_DENIED"
  | "SUBMODULE_LOCKED"
  | "AI_SERVICE_ERROR"
  | "AI_INVALID_RESPONSE"
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
  PRODUCTION_ORDER_EXISTS: 409,
  LOT_GENEALOGY_INVALID: 409,
  INSUFFICIENT_STOCK_FOR_MOVEMENT: 409,
  DUPLICATE_LEAD_EXISTS: 409,
  CRM_POSSIBLE_DUPLICATE: 409,
  CRM_DUPLICATE_RECORD: 409,
  RECORD_VERSION_CONFLICT: 409,
  DUPLICATE_CUSTOMER_EXISTS: 409,
  LEAVE_BALANCE_EXCEEDED: 409,
  AD_INTEGRATION_NOT_CONFIGURED: 400,
  AD_SYNC_FAILED: 502,
  OVER_INVOICE_NOT_ALLOWED: 409,
  OVER_PAYMENT_NOT_ALLOWED: 409,
  OVER_CREDIT_NOTE_NOT_ALLOWED: 409,
  DUPLICATE_EMAIL_EXISTS: 409,
  DUPLICATE_TAX_REGISTRATION_NO: 409,
  PRODUCTION_STAGE_ACCESS_DENIED: 403,
  BRANCH_ACCESS_DENIED: 403,
  SUBMODULE_LOCKED: 409,
  AI_SERVICE_ERROR: 502,
  AI_INVALID_RESPONSE: 502,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
};

/**
 * Every user-facing business-rule violation across modules should throw this
 * (or a helper that constructs one) rather than a generic Error, so route
 * handlers can map it to the structured `{ error: { code, message, details } }`
 * response shape instead of a bare 500.
 */
/**
 * Brand shared by every copy of this class. Next.js bundles this file once per
 * runtime layer (Server Components vs. Route Handlers), so an error thrown by a
 * singleton created in one layer (e.g. the globalThis-backed PermissionService)
 * is an instance of a *different* class than the one a route handler imports.
 * Plain prototype-based `instanceof` then fails and the error falls through to
 * the generic 500. `Symbol.for` is global to the process, so checking the brand
 * makes `instanceof BusinessRuleError` work across every copy.
 */
const BUSINESS_RULE_ERROR_BRAND = Symbol.for("fashion-erp.BusinessRuleError");

export class BusinessRuleError extends Error {
  readonly code: BusinessRuleErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BUSINESS_RULE_ERROR_BRAND] === true;
  }

  constructor(code: BusinessRuleErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    Object.defineProperty(this, BUSINESS_RULE_ERROR_BRAND, { value: true });
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

/**
 * Wraps the legacy `{ error: { code, message, details } }` body (read by
 * ~250 client call sites, so it is never removed) with the additive
 * top-level `{ success: false, message, errors? }` envelope — the
 * predictable, field-keyed shape the global Toast/API-client layer
 * (src/lib/api-client.ts) consumes.
 */
function envelope(
  inner: { code: string; message: string; details: unknown },
  errors?: Record<string, string[]>,
) {
  return { success: false as const, message: inner.message, ...(errors ? { errors } : {}), error: inner };
}

/** Builds a `{ "items.0.quantity": ["..."] }`-style field map from Zod issues. */
function zodIssuesToFieldErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (map[key] ??= []).push(issue.message);
  }
  return map;
}

export function toErrorResponse(error: unknown): { status: number; body: unknown } {
  const inner = toInnerErrorResponse(error);
  return { status: inner.status, body: envelope(inner.error, inner.errors) };
}

function toInnerErrorResponse(error: unknown): {
  status: number;
  error: { code: string; message: string; details: unknown };
  errors?: Record<string, string[]>;
} {
  if (error instanceof BusinessRuleError) {
    return { status: error.httpStatus, error: error.toResponseBody().error };
  }

  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    const zodError = error as { issues: { path: (string | number)[]; message: string }[] };
    const firstIssue = zodError.issues[0];
    return {
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: firstIssue
          ? firstIssue.path.length
            ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
            : firstIssue.message
          : "Invalid input.",
        details: { issues: zodError.issues },
      },
      errors: zodIssuesToFieldErrors(zodError.issues),
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
        error: {
          code: "VALIDATION_ERROR",
          message: "One or more values in this request are not in the expected format.",
          details: null,
        },
      };
    }
    if (prismaError.code === "P2002") {
      const target = prismaError.meta?.target;
      const field = Array.isArray(target) ? target.join(", ") : target;
      return {
        status: 409,
        error: {
          code: "DUPLICATE_DOC_NUMBER",
          message: field ? `A record with this ${field} already exists.` : "A record with these values already exists.",
          details: null,
        },
      };
    }
  }

  logger.error("Unhandled API error", { error });
  return {
    status: 500,
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again or contact support if the problem persists.",
      details: null,
    },
  };
}

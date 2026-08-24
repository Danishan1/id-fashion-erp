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
  | "LEAVE_BALANCE_EXCEEDED"
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
  LEAVE_BALANCE_EXCEEDED: 409,
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

  console.error("Unhandled error:", error);
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

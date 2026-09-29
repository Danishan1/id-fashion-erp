import { describe, expect, it } from "vitest";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn, toErrorResponse } from "./BusinessRuleError";

describe("BusinessRuleError", () => {
  it("maps DUPLICATE_DOC_NUMBER to HTTP 409", () => {
    const err = new BusinessRuleError("DUPLICATE_DOC_NUMBER", 'Code "X" is already in use.');
    expect(err.httpStatus).toBe(409);
  });

  it("maps PERMISSION_DENIED to HTTP 403", () => {
    const err = new BusinessRuleError("PERMISSION_DENIED", "You do not have permission.");
    expect(err.httpStatus).toBe(403);
  });

  it("maps NOT_FOUND to HTTP 404", () => {
    const err = new BusinessRuleError("NOT_FOUND", "Record not found.", { id: "abc" });
    expect(err.httpStatus).toBe(404);
    expect(err.toResponseBody()).toEqual({
      error: { code: "NOT_FOUND", message: "Record not found.", details: { id: "abc" } },
    });
  });

  it("defaults details to null when none are supplied", () => {
    const err = new BusinessRuleError("VALIDATION_ERROR", "Bad input.");
    expect(err.toResponseBody().error.details).toBeNull();
  });
});

describe("toErrorResponse", () => {
  it("unwraps a BusinessRuleError into its own status and body", () => {
    const { status, body } = toErrorResponse(new BusinessRuleError("UNBALANCED_JOURNAL", "Debits and credits must match."));
    expect(status).toBe(422);
    expect((body as { error: { code: string } }).error.code).toBe("UNBALANCED_JOURNAL");
  });

  it("maps a Zod-shaped error to VALIDATION_ERROR / 400", () => {
    const zodLike = { issues: [{ path: ["code"], message: "Required" }] };
    const { status, body } = toErrorResponse(zodLike);
    expect(status).toBe(400);
    expect((body as { error: { code: string; message: string } }).error.code).toBe("VALIDATION_ERROR");
    expect((body as { error: { code: string; message: string } }).error.message).toBe("code: Required");
  });

  it("falls back to a safe generic message for unknown errors, without leaking internal detail", () => {
    const { status, body } = toErrorResponse(new Error("some internal detail involving a connection string"));
    expect(status).toBe(500);
    const message = (body as { error: { message: string } }).error.message;
    expect(message).not.toContain("connection string");
    expect((body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
  });

  // Regression tests: these two Prisma error codes are reachable from any
  // module's `findFirst`-then-`create` duplicate check (P2002, a TOCTOU race)
  // or any bare `:id` route param (P2007, a malformed UUID) — previously both
  // fell through to a raw, unhelpful 500 instead of a clean expected response.
  it("maps a Prisma P2007 (malformed UUID) error to VALIDATION_ERROR / 400", () => {
    const prismaLike = { code: "P2007", message: "Invalid input value: invalid input syntax for type uuid" };
    const { status, body } = toErrorResponse(prismaLike);
    expect(status).toBe(400);
    expect((body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("maps a Prisma P2002 (unique constraint race) error to DUPLICATE_DOC_NUMBER / 409", () => {
    const prismaLike = { code: "P2002", meta: { target: ["company_id", "code"] } };
    const { status, body } = toErrorResponse(prismaLike);
    expect(status).toBe(409);
    const { code, message } = (body as { error: { code: string; message: string } }).error;
    expect(code).toBe("DUPLICATE_DOC_NUMBER");
    expect(message).toContain("company_id, code");
  });
});

describe("isUniqueConstraintViolationOnColumn", () => {
  it("matches the @prisma/adapter-pg driver-adapter error shape, confirmed live against this project's own dev database", () => {
    // Reproduced verbatim from an actual P2002 triggered against a real
    // idempotencyKey collision on sales_invoices in this session.
    const realDriverAdapterError = {
      code: "P2002",
      meta: {
        modelName: "SalesInvoice",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage: 'duplicate key value violates unique constraint "sales_invoices_company_id_idempotency_key_key"',
            kind: "UniqueConstraintViolation",
            constraint: { fields: ["company_id", "idempotency_key"] },
          },
        },
      },
    };
    expect(isUniqueConstraintViolationOnColumn(realDriverAdapterError, "idempotency_key")).toBe(true);
    expect(isUniqueConstraintViolationOnColumn(realDriverAdapterError, "sales_order_id")).toBe(false);
  });

  it("correctly distinguishes a different real constraint on the same table (one_active_per_order)", () => {
    const realDriverAdapterError = {
      code: "P2002",
      meta: {
        modelName: "SalesInvoice",
        driverAdapterError: {
          cause: {
            originalMessage: 'duplicate key value violates unique constraint "sales_invoices_one_active_per_order"',
            constraint: { fields: ["sales_order_id"] },
          },
        },
      },
    };
    expect(isUniqueConstraintViolationOnColumn(realDriverAdapterError, "sales_order_id")).toBe(true);
    expect(isUniqueConstraintViolationOnColumn(realDriverAdapterError, "idempotency_key")).toBe(false);
  });

  it("also matches the classic meta.target array shape, for forward compatibility with a non-driver-adapter Prisma setup", () => {
    const classicShape = { code: "P2002", meta: { target: ["company_id", "idempotency_key"] } };
    expect(isUniqueConstraintViolationOnColumn(classicShape, "idempotency_key")).toBe(true);
  });

  it("returns false for a non-P2002 error", () => {
    expect(isUniqueConstraintViolationOnColumn({ code: "P2025" }, "idempotency_key")).toBe(false);
  });

  it("returns false for a plain Error with no code at all", () => {
    expect(isUniqueConstraintViolationOnColumn(new Error("boom"), "idempotency_key")).toBe(false);
  });
});

describe("BusinessRuleError across bundled copies", () => {
  it("is recognized when thrown by a second copy of the module (another Next.js runtime layer)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    // A query suffix makes Vite load a second, separate copy of the module.
    // @ts-expect-error -- the "?copy" suffix is a Vite module-id trick, not a real path.
    const other: typeof import("./BusinessRuleError") = await import("./BusinessRuleError?copy");
    const foreign = new other.BusinessRuleError("PERMISSION_DENIED", "You do not have permission to create in production.");

    expect(other.BusinessRuleError).not.toBe(BusinessRuleError);
    expect(foreign instanceof BusinessRuleError).toBe(true);
    const res = toErrorResponse(foreign);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain("You do not have permission to create in production.");
  });

  it("does not treat a plain Error as a BusinessRuleError", () => {
    expect(new Error("x") instanceof BusinessRuleError).toBe(false);
    expect(toErrorResponse(new Error("x")).status).toBe(500);
  });
});

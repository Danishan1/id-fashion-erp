import { describe, expect, it } from "vitest";
import { BusinessRuleError, toErrorResponse } from "./BusinessRuleError";

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
});

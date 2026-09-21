import { describe, expect, it } from "vitest";
import { buildCompatibilityCheckResponseSchema, validateCompatibilityCheckResponse } from "./schema";

function item(overrides: Partial<{ subjectNumber: number; rating: string; reasoning: string; suggestion: string }> = {}) {
  return { subjectNumber: 1, rating: "COMPATIBLE", reasoning: "Fine.", suggestion: "No changes needed.", ...overrides };
}

function response(items: ReturnType<typeof item>[], overrides: Record<string, unknown> = {}) {
  return { items, overallSummary: "Summary.", overallRating: "COMPATIBLE", overallSuggestion: "No changes needed.", ...overrides };
}

describe("buildCompatibilityCheckResponseSchema", () => {
  it("accepts a valid single-subject response", () => {
    const result = buildCompatibilityCheckResponseSchema(1).safeParse(response([item({ subjectNumber: 1 })]));
    expect(result.success).toBe(true);
  });

  it("accepts subjectNumbers in any order, as long as every 1..N appears exactly once", () => {
    const result = buildCompatibilityCheckResponseSchema(3).safeParse(
      response([item({ subjectNumber: 3 }), item({ subjectNumber: 1 }), item({ subjectNumber: 2 })])
    );
    expect(result.success).toBe(true);
  });

  it("rejects a wrong total item count", () => {
    const result = buildCompatibilityCheckResponseSchema(2).safeParse(response([item({ subjectNumber: 1 })]));
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate subjectNumber, even if the total count happens to be correct", () => {
    const result = buildCompatibilityCheckResponseSchema(2).safeParse(response([item({ subjectNumber: 1 }), item({ subjectNumber: 1 })]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("appears more than once"))).toBe(true);
    }
  });

  it("rejects a subjectNumber out of the valid 1..N range", () => {
    const result = buildCompatibilityCheckResponseSchema(1).safeParse(response([item({ subjectNumber: 2 })]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("out of range"))).toBe(true);
    }
  });

  it("rejects a missing suggestion field", () => {
    const invalid = { ...response([]), items: [{ subjectNumber: 1, rating: "COMPATIBLE", reasoning: "Fine." }] };
    const result = buildCompatibilityCheckResponseSchema(1).safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects a missing overallSuggestion field", () => {
    const invalid: Record<string, unknown> = response([item()]);
    delete invalid.overallSuggestion;
    const result = buildCompatibilityCheckResponseSchema(1).safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("validateCompatibilityCheckResponse", () => {
  it("returns a specific, actionable error message naming the missing subject when the count is correct but a subject is duplicated/missing — this is what feeds the corrective retry", () => {
    // Correct total count (2), but both items claim subjectNumber 1 -- subject 2 is genuinely missing.
    const result = validateCompatibilityCheckResponse(2, response([item({ subjectNumber: 1 }), item({ subjectNumber: 1 })]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/subjectNumber 1|subjectNumber 2/);
    }
  });

  it("returns a generic-but-useful error message when the total item count itself is wrong", () => {
    const result = validateCompatibilityCheckResponse(2, response([item({ subjectNumber: 1 })]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/items/);
    }
  });

  it("returns the valid data unchanged on success", () => {
    const result = validateCompatibilityCheckResponse(1, response([item({ subjectNumber: 1 })]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.overallSuggestion).toBe("No changes needed.");
    }
  });
});

import { describe, expect, it } from "vitest";
import { validateProductSuggestionsResponse } from "./schema";

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    groups: [
      {
        targetCustomer: "WOMEN",
        items: [
          { productCategory: "Kurti", priorityRank: 1, ageGroup: "25-40", environmentKey: "STUDIO_WHITE", reasoning: "Good drape." },
        ],
      },
    ],
    overallSummary: "Suits Women well.",
    ...overrides,
  };
}

describe("validateProductSuggestionsResponse", () => {
  it("accepts a valid response using only real catalog values", () => {
    const result = validateProductSuggestionsResponse(validResponse());
    expect(result.success).toBe(true);
  });

  it("accepts multiple groups skipping unsuitable customer segments (not every segment required)", () => {
    const result = validateProductSuggestionsResponse(
      validResponse({
        groups: [
          { targetCustomer: "WOMEN", items: [{ productCategory: "Dress", priorityRank: 1, ageGroup: "18-25", environmentKey: "BEACH", reasoning: "x" }] },
          { targetCustomer: "MEN", items: [{ productCategory: "Shirt", priorityRank: 1, ageGroup: "25-40", environmentKey: "OFFICE", reasoning: "y" }] },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("rejects a productCategory that isn't a real category for that targetCustomer", () => {
    const result = validateProductSuggestionsResponse(
      validResponse({
        groups: [{ targetCustomer: "WOMEN", items: [{ productCategory: "Onesie", priorityRank: 1, ageGroup: "25-40", environmentKey: "STUDIO_WHITE", reasoning: "x" }] }],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not a real product category for WOMEN/);
  });

  it("rejects an ageGroup that isn't a real age group for that targetCustomer", () => {
    const result = validateProductSuggestionsResponse(
      validResponse({
        groups: [{ targetCustomer: "WOMEN", items: [{ productCategory: "Kurti", priorityRank: 1, ageGroup: "0-6 Months", environmentKey: "STUDIO_WHITE", reasoning: "x" }] }],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not a real age group for WOMEN/);
  });

  it("rejects an environmentKey that isn't one of the real allowed keys", () => {
    const result = validateProductSuggestionsResponse(
      validResponse({
        groups: [{ targetCustomer: "WOMEN", items: [{ productCategory: "Kurti", priorityRank: 1, ageGroup: "25-40", environmentKey: "MARS_COLONY", reasoning: "x" }] }],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not one of the exact allowed environment keys/);
  });

  it("rejects a targetCustomer that isn't one of the real enum values", () => {
    const result = validateProductSuggestionsResponse(validResponse({ groups: [{ targetCustomer: "ALIENS", items: [] }] }));
    expect(result.success).toBe(false);
  });

  it("rejects zero groups", () => {
    const result = validateProductSuggestionsResponse(validResponse({ groups: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects a group with zero items", () => {
    const result = validateProductSuggestionsResponse(validResponse({ groups: [{ targetCustomer: "WOMEN", items: [] }] }));
    expect(result.success).toBe(false);
  });

  it("rejects a missing overallSummary", () => {
    const invalid: Record<string, unknown> = validResponse();
    delete invalid.overallSummary;
    const result = validateProductSuggestionsResponse(invalid);
    expect(result.success).toBe(false);
  });
});

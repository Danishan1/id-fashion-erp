import { describe, expect, it } from "vitest";
import { approvalReasons } from "./quotation-approval";

const limits = { maxDiscountPercent: 10, maxTotal: 500000 };

describe("approvalReasons (D2)", () => {
  it("needs nothing at or below both limits", () => {
    expect(approvalReasons({ lines: [{ lineNumber: 1, discountPercent: 10 }], grandTotal: 500000 }, limits)).toEqual([]);
  });
  it("fires for a discount above the limit and names the lines", () => {
    const r = approvalReasons({ lines: [{ lineNumber: 1, discountPercent: 5 }, { lineNumber: 2, discountPercent: 12.5 }, { lineNumber: 3, discountPercent: 15 }], grandTotal: 1000 }, limits);
    expect(r).toEqual(["Discount 15% on lines 2, 3 is above the 10% limit"]);
  });
  it("fires for a total above the limit, and both rules can fire together", () => {
    expect(approvalReasons({ lines: [], grandTotal: 500000.01 }, limits)).toHaveLength(1);
    expect(approvalReasons({ lines: [{ lineNumber: 1, discountPercent: 11 }], grandTotal: 600000 }, limits)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import { calculateQuotation } from "./quotation-calc";

const base = { freightAmount: 0, freightGstRate: 0, otherChargesAmount: 0, otherChargesGstRate: 0, companyStateCode: "33", placeOfSupplyStateCode: "33" };

describe("calculateQuotation", () => {
  it("works line by line: gross, discount, taxable, GST, CGST/SGST halves with the odd paisa on SGST", () => {
    const r = calculateQuotation({ ...base, lines: [{ quantity: 3, unitPrice: 33.33, discountPercent: 10, gstRate: 5 }] });
    const l = r.lines[0];
    expect(l.grossAmount).toBe(99.99);
    expect(l.discountAmount).toBe(10); // 9.999 → 10.00
    expect(l.taxableAmount).toBe(89.99);
    expect(l.taxAmount).toBe(4.5); // 4.4995 → 4.50
    expect(l.cgstAmount + l.sgstAmount).toBeCloseTo(4.5, 10);
    expect([l.cgstRate, l.sgstRate, l.igstRate]).toEqual([2.5, 2.5, 0]);
    expect(r.isInterState).toBe(false);
    expect(r.grandTotal).toBe(94.49);
  });

  it("uses IGST when the place of supply is another state", () => {
    const r = calculateQuotation({ ...base, placeOfSupplyStateCode: "27", lines: [{ quantity: 1200, unitPrice: 245.5, discountPercent: 0, gstRate: 5 }] });
    expect(r.isInterState).toBe(true);
    expect(r.lines[0]).toMatchObject({ taxableAmount: 294600, igstAmount: 14730, cgstAmount: 0, sgstAmount: 0, igstRate: 5 });
    expect(r.igstTotal).toBe(14730);
    expect(r.grandTotal).toBe(309330);
  });

  it("treats a missing company or place-of-supply state as intra-state", () => {
    expect(calculateQuotation({ ...base, companyStateCode: null, placeOfSupplyStateCode: "27", lines: [] }).isInterState).toBe(false);
    expect(calculateQuotation({ ...base, placeOfSupplyStateCode: null, lines: [] }).isInterState).toBe(false);
  });

  it("taxes freight and other charges at their own rates and reconciles every total", () => {
    const r = calculateQuotation({
      ...base,
      freightAmount: 1500,
      freightGstRate: 18,
      otherChargesAmount: 250.5,
      otherChargesGstRate: 0,
      lines: [
        { quantity: 10, unitPrice: 199.99, discountPercent: 5, gstRate: 5 },
        { quantity: 2.5, unitPrice: 80, discountPercent: 0, gstRate: 12 },
        { quantity: 4, unitPrice: 0, discountPercent: 0, gstRate: 5 }, // free line
      ],
    });
    expect(r.freight).toMatchObject({ taxableAmount: 1500, taxAmount: 270 });
    expect(r.chargesTotal).toBe(1750.5);
    expect(r.subtotalAmount).toBe(2199.9);
    expect(r.discountTotal).toBe(100);
    expect(r.taxableTotal).toBe(2099.9);
    expect(r.lines[2]).toMatchObject({ grossAmount: 0, taxAmount: 0, lineAmount: 0 });
    expect(r.taxTotal).toBe(r.cgstTotal + r.sgstTotal + r.igstTotal);
    expect(r.taxTotal).toBe(Math.round((r.lines.reduce((s, l) => s + l.taxAmount, 0) + 270) * 100) / 100);
    expect(r.grandTotal).toBe(Math.round((r.taxableTotal + r.chargesTotal + r.taxTotal) * 100) / 100);
  });

  it("returns zeros for an empty quotation", () => {
    expect(calculateQuotation({ ...base, lines: [] })).toMatchObject({ grandTotal: 0, taxTotal: 0, subtotalAmount: 0 });
  });
});

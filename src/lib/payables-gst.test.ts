import { describe, expect, it } from "vitest";
import { calculatePayableInvoice, calculatePayableLine, isInterStateSupply, isValidHsn } from "./payables-gst";

describe("calculatePayableLine", () => {
  it("intra-state: GST split into CGST + SGST, odd paisa goes to SGST", () => {
    // 3 × 33.33 = 99.99; 5% = 4.9995 -> 5.00; halves 2.50 / 2.50
    const r = calculatePayableLine({ rate: 33.33, quantity: 3, gstRate: 5 }, false);
    expect(r).toMatchObject({ grossAmount: 99.99, taxableAmount: 99.99, taxAmount: 5, cgstAmount: 2.5, sgstAmount: 2.5, igstAmount: 0 });
    expect(r.cgstRate).toBe(2.5);
    expect(r.sgstRate).toBe(2.5);

    const odd = calculatePayableLine({ rate: 10.1, quantity: 1, gstRate: 18 }, false); // tax 1.818 -> 1.82
    expect(odd.cgstAmount + odd.sgstAmount).toBeCloseTo(odd.taxAmount, 10);
    expect(odd).toMatchObject({ cgstAmount: 0.91, sgstAmount: 0.91 });
  });

  it("inter-state: all IGST", () => {
    const r = calculatePayableLine({ rate: 1000, quantity: 2, gstRate: 12 }, true);
    expect(r).toMatchObject({ taxableAmount: 2000, igstRate: 12, igstAmount: 240, cgstAmount: 0, sgstAmount: 0, lineAmount: 2240 });
  });

  it("discount %: wins over a discount amount; discount amount is capped at the gross", () => {
    expect(calculatePayableLine({ rate: 100, quantity: 10, discountPercentage: 10, discountAmount: 999, gstRate: 0 }, false)).toMatchObject({
      discountAmount: 100,
      taxableAmount: 900,
    });
    expect(calculatePayableLine({ rate: 100, quantity: 1, discountAmount: 500, gstRate: 0 }, false)).toMatchObject({
      discountAmount: 100,
      taxableAmount: 0,
    });
  });
});

describe("calculatePayableInvoice", () => {
  const lines = [
    { rate: 500, quantity: 2, gstRate: 18 }, // 1000 + 180
    { rate: 250, quantity: 1, gstRate: 5, discountAmount: 50 }, // 200 + 10
  ];

  it("totals: taxable, GST, discount and grand total; payable = grand total normally", () => {
    const t = calculatePayableInvoice(lines, { isInterState: false, isReverseCharge: false });
    expect(t).toMatchObject({ taxableTotal: 1200, gstTotal: 190, discountTotal: 50, grandTotal: 1390, payableToParty: 1390, cgstTotal: 95, sgstTotal: 95 });
  });

  it("reverse charge: GST is still worked out but the party gets only the taxable value", () => {
    const t = calculatePayableInvoice(lines, { isInterState: true, isReverseCharge: true });
    expect(t).toMatchObject({ gstTotal: 190, igstTotal: 190, grandTotal: 1390, payableToParty: 1200 });
  });
});

describe("helpers", () => {
  it("inter-state only when both states are known and differ", () => {
    expect(isInterStateSupply("07", "27")).toBe(true);
    expect(isInterStateSupply("07", "07")).toBe(false);
    expect(isInterStateSupply(null, "27")).toBe(false);
  });

  it("HSN must be 4, 6 or 8 digits", () => {
    expect(isValidHsn("6109")).toBe(true);
    expect(isValidHsn("610910")).toBe(true);
    expect(isValidHsn("61091000")).toBe(true);
    expect(isValidHsn("61091")).toBe(false);
    expect(isValidHsn("abcd")).toBe(false);
  });
});

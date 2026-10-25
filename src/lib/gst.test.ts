import { describe, expect, it } from "vitest";
import { round2 } from "./money";
import {
  calculateInvoiceGst,
  calculateLineGst,
  extractStateCodeFromGstin,
  isValidStateCode,
} from "./gst";

describe("GST State Codes and GSTIN extraction", () => {
  it("recognizes standard Indian state codes", () => {
    expect(isValidStateCode("07")).toBe(true); // Delhi
    expect(isValidStateCode("27")).toBe(true); // Maharashtra
    expect(isValidStateCode("29")).toBe(true); // Karnataka
    expect(isValidStateCode("33")).toBe(true); // Tamil Nadu
    expect(isValidStateCode("97")).toBe(true); // Other Territory
  });

  it("rejects invalid or non-existent state codes", () => {
    expect(isValidStateCode("00")).toBe(false);
    expect(isValidStateCode("99")).toBe(false);
    expect(isValidStateCode("XX")).toBe(false);
    expect(isValidStateCode("")).toBe(false);
    expect(isValidStateCode(null)).toBe(false);
    expect(isValidStateCode(undefined)).toBe(false);
  });

  it("extracts state code from valid 15-character GSTIN", () => {
    // Delhi GSTIN
    expect(extractStateCodeFromGstin("07AAAAA0000A1Z5")).toBe("07");
    // Maharashtra GSTIN
    expect(extractStateCodeFromGstin("27ABCDE1234F2Z8")).toBe("27");
    // Handles lowercase and surrounding whitespace
    expect(extractStateCodeFromGstin("  07aaaaa0000a1z5  ")).toBe("07");
  });

  it("returns null for malformed or invalid GSTINs", () => {
    expect(extractStateCodeFromGstin(null)).toBeNull();
    expect(extractStateCodeFromGstin(undefined)).toBeNull();
    expect(extractStateCodeFromGstin("")).toBeNull();
    expect(extractStateCodeFromGstin("07AAAAA0000A1Z")).toBeNull(); // 14 chars
    expect(extractStateCodeFromGstin("07AAAAA0000A1Z55")).toBeNull(); // 16 chars
    expect(extractStateCodeFromGstin("99AAAAA0000A1Z5")).toBeNull(); // Invalid state code 99
    expect(extractStateCodeFromGstin("071234567890123")).toBeNull(); // Bad regex
  });
});

describe("calculateInvoiceGst — Header Level", () => {
  it("returns zeros when reverse charge applies", () => {
    const res = calculateInvoiceGst(180, false, true);
    expect(res).toEqual({ cgstAmount: 0, sgstAmount: 0, igstAmount: 0 });
  });

  it("returns zeros when taxAmount is zero or negative", () => {
    expect(calculateInvoiceGst(0, false, false)).toEqual({ cgstAmount: 0, sgstAmount: 0, igstAmount: 0 });
    expect(calculateInvoiceGst(-50, false, false)).toEqual({ cgstAmount: 0, sgstAmount: 0, igstAmount: 0 });
  });

  it("allocates 100% to IGST on inter-state supply", () => {
    const res = calculateInvoiceGst(180.55, true, false);
    expect(res).toEqual({
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 180.55,
    });
  });

  it("splits evenly into CGST and SGST for even paisa amounts", () => {
    const res = calculateInvoiceGst(100.0, false, false);
    expect(res.cgstAmount).toBe(50.0);
    expect(res.sgstAmount).toBe(50.0);
    expect(res.igstAmount).toBe(0);
    expect(res.cgstAmount + res.sgstAmount).toBe(100.0);
  });

  it("enforces deterministic odd-paisa reconciliation (no drift)", () => {
    // 100.01 / 2 = 50.005 -> rounds to 50.01 CGST, SGST becomes 100.01 - 50.01 = 50.00
    const res1 = calculateInvoiceGst(100.01, false, false);
    expect(res1.cgstAmount).toBe(50.01);
    expect(res1.sgstAmount).toBe(50.0);
    expect(round2(res1.cgstAmount + res1.sgstAmount)).toBe(100.01);

    // 0.01 tax -> 0.01 CGST, 0.00 SGST, sum === 0.01
    const res2 = calculateInvoiceGst(0.01, false, false);
    expect(res2.cgstAmount).toBe(0.01);
    expect(res2.sgstAmount).toBe(0.0);
    expect(round2(res2.cgstAmount + res2.sgstAmount)).toBe(0.01);

    // 0.03 tax -> 0.02 CGST, 0.01 SGST, sum === 0.03
    const res3 = calculateInvoiceGst(0.03, false, false);
    expect(res3.cgstAmount).toBe(0.02);
    expect(res3.sgstAmount).toBe(0.01);
    expect(round2(res3.cgstAmount + res3.sgstAmount)).toBe(0.03);
  });
});

describe("calculateLineGst — Line Level", () => {
  it("returns zero tax breakdown for reverse charge or 0% GST", () => {
    const rcm = calculateLineGst(500, 18, false, true);
    expect(rcm).toEqual({
      lineAmount: 500,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      lineTaxAmount: 0,
      lineTotal: 500,
    });

    const zeroGst = calculateLineGst(500, 0, false, false);
    expect(zeroGst).toEqual({
      lineAmount: 500,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      lineTaxAmount: 0,
      lineTotal: 500,
    });
  });

  it("calculates inter-state line tax and total correctly", () => {
    // 500 * 18% = 90
    const res = calculateLineGst(500, 18, true, false);
    expect(res).toEqual({
      lineAmount: 500,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 90,
      lineTaxAmount: 90,
      lineTotal: 590,
    });
  });

  it("calculates intra-state line tax with odd-paisa reconciliation", () => {
    // 105.55 * 5% = 5.2775 -> round2 gives 5.28 lineTaxAmount
    // 5.28 / 2 = 2.64 CGST, 2.64 SGST
    const res = calculateLineGst(105.55, 5, false, false);
    expect(res.lineTaxAmount).toBe(5.28);
    expect(res.cgstAmount).toBe(2.64);
    expect(res.sgstAmount).toBe(2.64);
    expect(res.cgstAmount + res.sgstAmount).toBe(5.28);
    expect(res.lineTotal).toBe(110.83); // 105.55 + 5.28
  });

  it("handles fractional line odd-paisa amounts without loss", () => {
    // 33.33 * 5% = 1.6665 -> round2 gives 1.67
    // 1.67 / 2 = 0.835 -> round2(0.835) = 0.84 CGST, SGST = 1.67 - 0.84 = 0.83
    const res = calculateLineGst(33.33, 5, false, false);
    expect(res.lineTaxAmount).toBe(1.67);
    expect(res.cgstAmount).toBe(0.84);
    expect(res.sgstAmount).toBe(0.83);
    expect(res.cgstAmount + res.sgstAmount).toBe(1.67);
    expect(res.lineTotal).toBe(35.0); // 33.33 + 1.67
  });
});

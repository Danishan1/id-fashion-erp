import { describe, expect, it } from "vitest";
import { gstInvoiceSchema } from "./gst-invoice.schema";
import { buildGstInvoiceJournalLines, computeGstInvoice } from "./gst-invoice";

const DELHI_GSTIN = "07ABCDE1234F1Z5";

const base = {
  invoiceNumber: "INV-1",
  invoiceDate: "2026-10-28",
  lines: [
    { description: "Electrical work", expenseAccountId: "11111111-1111-4111-8111-111111111111", rate: 500, quantity: 2, gstRate: 18 },
    { description: "Wire", expenseAccountId: "22222222-2222-4222-8222-222222222222", rate: 250, quantity: 1, gstRate: 5, discountAmount: 50 },
  ],
};

describe("gstInvoiceSchema", () => {
  it("refuses bad decimals, an HSN of the wrong length, a bad GSTIN and no lines", () => {
    const bad = (patch: object) => gstInvoiceSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ lines: [{ ...base.lines[0], rate: 10.123 }] })).toBe(false);
    expect(bad({ lines: [{ ...base.lines[0], quantity: 1.12345 }] })).toBe(false);
    expect(bad({ lines: [{ ...base.lines[0], gstRate: 101 }] })).toBe(false);
    expect(bad({ lines: [{ ...base.lines[0], hsnCode: "123" }] })).toBe(false);
    expect(bad({ payToGstin: "NOTAGSTIN" })).toBe(false);
    expect(bad({ placeOfSupplyStateCode: "99" })).toBe(false);
    expect(bad({ lines: [] })).toBe(false);
  });

  it("a stock item only on a 'for stock' line", () => {
    const line = { ...base.lines[0], productId: "33333333-3333-4333-8333-333333333333" };
    expect(gstInvoiceSchema.safeParse({ ...base, lines: [line] }).success).toBe(false);
    expect(gstInvoiceSchema.safeParse({ ...base, lines: [{ ...line, isForStock: true }] }).success).toBe(true);
  });
});

describe("computeGstInvoice", () => {
  it("place of supply missing -> our own state -> CGST + SGST", () => {
    const r = computeGstInvoice(gstInvoiceSchema.parse(base), DELHI_GSTIN);
    expect(r.header.placeOfSupplyStateCode).toBe("07");
    expect(r.isInterState).toBe(false);
    expect(r.header).toMatchObject({ invoiceTaxableTotal: 1200, invoiceGstTotal: 190, invoiceGrandTotal: 1390, invoiceDiscountTotal: 50 });
    expect(r.lines[0]).toMatchObject({ lineNumber: 1, cgstAmount: 90, sgstAmount: 90, igstAmount: 0 });
    expect(r.payableToParty).toBe(1390);
  });

  it("another state -> IGST; RCM -> party is paid only the taxable value", () => {
    const r = computeGstInvoice(gstInvoiceSchema.parse({ ...base, placeOfSupplyStateCode: "27", isReverseCharge: true }), DELHI_GSTIN);
    expect(r.isInterState).toBe(true);
    expect(r.lines[0]).toMatchObject({ igstAmount: 180, cgstAmount: 0 });
    expect(r.payableToParty).toBe(1200);
  });
});

describe("buildGstInvoiceJournalLines", () => {
  const lines = [
    { expenseAccountId: "EXP-A", taxableAmount: 1000, cgstAmount: 90, sgstAmount: 90, igstAmount: 0 },
    { expenseAccountId: "EXP-A", taxableAmount: 200, cgstAmount: 5, sgstAmount: 5, igstAmount: 0 },
  ];
  const accounts = { payableAccountId: "PAY", gstItcAccountId: "ITC", gstRcmPayableAccountId: "RCM" };
  const run = (isItcApplicable: boolean, isReverseCharge: boolean) =>
    buildGstInvoiceJournalLines({ lines, isItcApplicable, isReverseCharge, accounts, narration: "Bill" });
  const balanced = (j: { debitAmount: number; creditAmount: number }[]) =>
    expect(j.reduce((s, l) => s + l.debitAmount, 0)).toBeCloseTo(j.reduce((s, l) => s + l.creditAmount, 0), 10);

  it("ITC=Y RCM=N: Dr expense (taxable, same account combined) + Dr ITC / Cr payable (grand total)", () => {
    const j = run(true, false);
    expect(j.map((l) => [l.accountId, l.debitAmount, l.creditAmount])).toEqual([
      ["EXP-A", 1200, 0],
      ["ITC", 190, 0],
      ["PAY", 0, 1390],
    ]);
    balanced(j);
  });

  it("ITC=N RCM=N: GST becomes cost", () => {
    const j = run(false, false);
    expect(j.map((l) => [l.accountId, l.debitAmount, l.creditAmount])).toEqual([
      ["EXP-A", 1390, 0],
      ["PAY", 0, 1390],
    ]);
  });

  it("RCM=Y ITC=Y: Dr expense + Dr ITC / Cr RCM payable / Cr party (taxable)", () => {
    const j = run(true, true);
    expect(j.map((l) => [l.accountId, l.debitAmount, l.creditAmount])).toEqual([
      ["EXP-A", 1200, 0],
      ["ITC", 190, 0],
      ["RCM", 0, 190],
      ["PAY", 0, 1200],
    ]);
    balanced(j);
  });

  it("RCM=Y ITC=N: Dr expense (taxable + GST) / Cr RCM payable / Cr party (taxable)", () => {
    const j = run(false, true);
    expect(j.map((l) => [l.accountId, l.debitAmount, l.creditAmount])).toEqual([
      ["EXP-A", 1390, 0],
      ["RCM", 0, 190],
      ["PAY", 0, 1200],
    ]);
    balanced(j);
  });

  it("refuses a line with no account", () => {
    expect(() =>
      buildGstInvoiceJournalLines({ lines: [{ ...lines[0], expenseAccountId: null }], isItcApplicable: true, isReverseCharge: false, accounts, narration: "x" })
    ).toThrow(/account/);
  });
});

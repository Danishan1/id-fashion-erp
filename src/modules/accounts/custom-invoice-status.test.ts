import { describe, it, expect } from "vitest";
import {
  getDerivedCustomInvoiceStatus,
  CUSTOM_INVOICE_STATUS_LABELS,
  CUSTOM_INVOICE_STATUS_BADGE_CLASS,
} from "./custom-invoice-status";

describe("Custom Invoice Derived Status", () => {
  it("returns CANCELLED when status is CANCELLED regardless of financial balances", () => {
    expect(
      getDerivedCustomInvoiceStatus({
        status: "CANCELLED",
        balanceDue: 0,
        paidAmount: 1000,
        creditedAmount: 0,
        grandTotal: 1000,
      })
    ).toBe("CANCELLED");

    expect(
      getDerivedCustomInvoiceStatus({
        status: "CANCELLED",
        balanceDue: 500,
        paidAmount: 0,
        creditedAmount: 0,
        grandTotal: 500,
      })
    ).toBe("CANCELLED");
  });

  it("returns ISSUED for an active invoice with zero payments and zero credits", () => {
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 1180,
        paidAmount: 0,
        creditedAmount: 0,
        grandTotal: 1180,
      })
    ).toBe("ISSUED");

    // Also handles string inputs
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: "2500.00",
        paidAmount: "0.00",
        creditedAmount: "0.00",
        grandTotal: "2500.00",
      })
    ).toBe("ISSUED");
  });

  it("returns PARTIALLY_PAID when payment has been recorded but positive balance remains", () => {
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 500,
        paidAmount: 500,
        creditedAmount: 0,
        grandTotal: 1000,
      })
    ).toBe("PARTIALLY_PAID");

    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: "400.00",
        paidAmount: "600.00",
        creditedAmount: "0.00",
        grandTotal: "1000.00",
      })
    ).toBe("PARTIALLY_PAID");
  });

  it("returns PARTIALLY_PAID when credit note has been applied but positive balance remains", () => {
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 800,
        paidAmount: 0,
        creditedAmount: 200,
        grandTotal: 1000,
      })
    ).toBe("PARTIALLY_PAID");
  });

  it("returns PAID when balanceDue reaches zero or negative through payments", () => {
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 0,
        paidAmount: 1180,
        creditedAmount: 0,
        grandTotal: 1180,
      })
    ).toBe("PAID");

    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: "-0.01",
        paidAmount: "1180.01",
        creditedAmount: "0.00",
        grandTotal: "1180.00",
      })
    ).toBe("PAID");
  });

  it("returns PAID when balanceDue reaches zero through credit notes or combinations", () => {
    // 100% credited
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 0,
        paidAmount: 0,
        creditedAmount: 500,
        grandTotal: 500,
      })
    ).toBe("PAID");

    // Partial payment + partial credit note settling total
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 0,
        paidAmount: 600,
        creditedAmount: 400,
        grandTotal: 1000,
      })
    ).toBe("PAID");
  });

  it("returns PAID for a zero-value invoice with zero balance", () => {
    expect(
      getDerivedCustomInvoiceStatus({
        status: "DRAFT",
        balanceDue: 0,
        paidAmount: 0,
        creditedAmount: 0,
        grandTotal: 0,
      })
    ).toBe("PAID");
  });

  it("provides valid badge classes and human labels for all derived statuses", () => {
    const statuses = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;
    for (const s of statuses) {
      expect(CUSTOM_INVOICE_STATUS_LABELS[s]).toBeDefined();
      expect(typeof CUSTOM_INVOICE_STATUS_LABELS[s]).toBe("string");
      expect(CUSTOM_INVOICE_STATUS_BADGE_CLASS[s]).toBeDefined();
      expect(typeof CUSTOM_INVOICE_STATUS_BADGE_CLASS[s]).toBe("string");
    }
  });
});

import { describe, expect, it } from "vitest";
import { renderCreditNotePdfBuffer, type CreditNotePdfData } from "./custom-invoice-credit-note-pdf";

function createMockCreditNote(
  type: string = "OVERALL_DISCOUNT",
  overrides: Partial<CreditNotePdfData> = {}
): CreditNotePdfData {
  return {
    id: "cn-test-1",
    creditNoteNumber: "CN-2026-0001",
    creditNoteDate: "2026-10-14",
    type,
    reason: "Post-sale commercial volume discount",
    totalAmount: 500,
    status: "ISSUED",
    createdBy: { fullName: "Test Staff" },
    customInvoice: {
      id: "inv-test-1",
      invoiceNumber: "INV-2026-0042",
      invoiceDate: "2026-10-10",
      placeOfSupplyStateCode: "07",
      customer: {
        name: "Acme Retail Store",
        code: "CUST-007",
        taxRegistrationNo: "07AABCU9603R1ZM",
        billingAddress: "Connaught Place, New Delhi",
        shippingAddress: "Connaught Place, New Delhi",
        city: "New Delhi",
        pinCode: "110001",
      },
      invoiceSeries: { name: "Retail Series", prefix: "RS" },
    },
    company: {
      name: "Fashion ERP Studio",
      legalName: "Fashion ERP Studio Pvt Ltd",
      taxRegistrationNo: "07AAAAA0000A1Z5",
      addressJson: { address: "123 Okhla Phase 3", city: "New Delhi", state: "Delhi", pinCode: "110020" },
    },
    items: [],
    ...overrides,
  };
}

describe("Credit Note PDF Generator", () => {
  it("renders a valid PDF buffer for an OVERALL_DISCOUNT credit note", async () => {
    const data = createMockCreditNote("OVERALL_DISCOUNT", {
      totalAmount: 1250.5,
      items: [],
    });

    const buffer = await renderCreditNotePdfBuffer(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF buffer for a PRODUCT_WISE itemized credit note", async () => {
    const data = createMockCreditNote("PRODUCT_WISE", {
      totalAmount: 800,
      reason: "Minor fabric flaw allowance",
      items: [
        {
          id: "cni-1",
          quantity: null,
          amount: 500,
          customInvoiceItem: {
            id: "item-1",
            itemName: "Linen Cotton Shirt (Navy, L)",
            hsnCode: "620520",
            unitPrice: 1500,
            gstPercentage: 12,
          },
        },
        {
          id: "cni-2",
          quantity: null,
          amount: 300,
          customInvoiceItem: {
            id: "item-2",
            itemName: "Cotton Chinos (Khaki, 32)",
            hsnCode: "620342",
            unitPrice: 1800,
            gstPercentage: 12,
          },
        },
      ],
    });

    const buffer = await renderCreditNotePdfBuffer(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF buffer for a PRODUCT_RETURN credit note with quantities", async () => {
    const data = createMockCreditNote("PRODUCT_RETURN", {
      totalAmount: 3600,
      reason: "Customer size return (2 units)",
      items: [
        {
          id: "cni-3",
          quantity: 2,
          amount: 3600,
          customInvoiceItem: {
            id: "item-3",
            itemName: "Silk Evening Gown (Black, M)",
            hsnCode: "620449",
            unitPrice: 1800,
            gstPercentage: 18,
          },
        },
      ],
    });

    const buffer = await renderCreditNotePdfBuffer(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF buffer for a CANCELLED credit note", async () => {
    const data = createMockCreditNote("OVERALL_DISCOUNT", {
      status: "CANCELLED",
      totalAmount: 450,
      reason: "Issued in error - cancelled",
    });

    const buffer = await renderCreditNotePdfBuffer(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

import { describe, expect, it } from "vitest";
import { renderCustomInvoicePdf, customInvoicePdfHeaders, type CustomInvoicePdfData } from "./custom-invoice-pdf";

function createMockInvoiceData(overrides: Partial<CustomInvoicePdfData["invoice"]> = {}, extraOverrides: Partial<CustomInvoicePdfData> = {}): CustomInvoicePdfData {
  return {
    company: {
      name: "Acme Apparel Ltd",
      legalName: "Acme Apparel Private Limited",
      taxRegistrationNo: "08ABCDE1234F1Z5",
      addressLine: "Plot 42, Sitapura Industrial Area, Jaipur",
    },
    customer: {
      name: "Vogue Retailers",
      code: "CUST-001",
      taxRegistrationNo: "08XYZAB5678C1Z2",
      billingAddress: "Shop 12, Fashion Mall, Jaipur",
      city: "Jaipur",
      pinCode: "302022",
      country: "India",
    },
    invoice: {
      invoiceNumber: "INV-2026-0001",
      invoiceDate: "14 Oct 2026",
      hasDueDate: true,
      dueDate: "28 Oct 2026",
      invoiceType: "TAX_INVOICE",
      seriesName: "Main Series",
      isReverseCharge: false,
      placeOfSupplyStateCode: "08",
      isInterState: false,
      subtotalAmount: 1000,
      discountPercentage: 10,
      discountAmount: 100,
      taxAmount: 90,
      cgstAmount: 45,
      sgstAmount: 45,
      igstAmount: 0,
      grandTotal: 1090,
      advancePaymentAmount: null,
      advancePaymentTitle: null,
      payableAmountValue: null,
      payableAmountTitle: null,
      paidAmount: 500,
      creditedAmount: 100,
      balanceDue: 490,
      notes: ["Goods once sold are subject to company warranty terms."],
      termsAndConditions: "1. Payment within 15 days.\n2. Interest @18% p.a. on overdue bills.",
      ...overrides,
    },
    items: [
      {
        itemName: "Premium Cotton Oxford Shirt - Slim Fit Blue with Detailed Embroidery",
        hsnCode: "6205",
        quantity: 10,
        unitPrice: 100,
        gstPercentage: 10,
        lineAmount: 1000,
        lineTaxAmount: 90,
        lineTotal: 1090,
      },
    ],
    bankAccount: {
      bankName: "HDFC Bank",
      accountHolderName: "Acme Apparel Private Limited",
      accountNumber: "50200012345678",
      ifscCode: "HDFC0001234",
      branch: "Sitapura Branch",
      upiId: "acmeapparel@hdfcbank",
    },
    generatedAt: "14/10/2026, 14:30:00",
    generatedByName: "Audit Operator",
    ...extraOverrides,
  };
}

describe("Custom Invoice PDF Generator", () => {
  it("renders a valid PDF buffer for an intra-state invoice with CGST and SGST", async () => {
    const data = createMockInvoiceData({
      isInterState: false,
      placeOfSupplyStateCode: "08",
      cgstAmount: 45,
      sgstAmount: 45,
      igstAmount: 0,
      taxAmount: 90,
    });

    const buffer = await renderCustomInvoicePdf(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF magic bytes %PDF-
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF buffer for an inter-state invoice with IGST", async () => {
    const data = createMockInvoiceData({
      isInterState: true,
      placeOfSupplyStateCode: "27",
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 90,
      taxAmount: 90,
    });

    const buffer = await renderCustomInvoicePdf(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF buffer for a legacy invoice with null isInterState without fabricating splits", async () => {
    const data = createMockInvoiceData({
      isInterState: null,
      placeOfSupplyStateCode: null,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxAmount: 90,
    });

    const buffer = await renderCustomInvoicePdf(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a valid PDF buffer for a reverse charge invoice", async () => {
    const data = createMockInvoiceData({
      isReverseCharge: true,
      taxAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      grandTotal: 1000,
      balanceDue: 1000,
    });

    const buffer = await renderCustomInvoicePdf(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("omits bank details cleanly when bankAccount is null (0 or multiple active accounts)", async () => {
    const data = createMockInvoiceData({}, { bankAccount: null });

    const buffer = await renderCustomInvoicePdf(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles proforma invoice type and multiple line items without errors", async () => {
    const base = createMockInvoiceData({ invoiceType: "PROFORMA_INVOICE" });
    base.items.push({
      itemName: "Secondary Fabric Lining Material",
      hsnCode: "5208",
      quantity: 5,
      unitPrice: 50,
      gstPercentage: 5,
      lineAmount: 250,
      lineTaxAmount: 12.5,
      lineTotal: 262.5,
    });

    const buffer = await renderCustomInvoicePdf(base);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("generates correct attachment and inline headers", () => {
    const attachmentHeaders = customInvoicePdfHeaders("INV-001.pdf", "attachment");
    expect(attachmentHeaders["Content-Type"]).toBe("application/pdf");
    expect(attachmentHeaders["Content-Disposition"]).toBe('attachment; filename="INV-001.pdf"');

    const inlineHeaders = customInvoicePdfHeaders("INV-001.pdf", "inline");
    expect(inlineHeaders["Content-Type"]).toBe("application/pdf");
    expect(inlineHeaders["Content-Disposition"]).toBe('inline; filename="INV-001.pdf"');
  });

  it("renders a valid PDF buffer including separate shipping address and derived PAID status", async () => {
    const data = createMockInvoiceData(
      {
        status: "DRAFT",
        grandTotal: 1180,
        paidAmount: 1180,
        creditedAmount: 0,
        balanceDue: 0,
      },
      {
        customer: {
          name: "Global Styles Inc",
          code: "CUST-008",
          taxRegistrationNo: "08AABCS1429B1ZB",
          billingAddress: "Corporate Tower, Jaipur, Rajasthan",
          shippingAddress: "Warehouse 4B, Sitapura Industrial Area, Jaipur, Rajasthan",
          city: "Jaipur",
          pinCode: "302022",
          country: "India",
        },
      }
    );

    const buffer = await renderCustomInvoicePdf(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

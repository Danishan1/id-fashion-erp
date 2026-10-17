import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsxBuffer, sanitizeSpreadsheetText, type XlsxColumn } from "@/lib/xlsx";

describe("Custom Invoice Excel Export & Formula Sanitization", () => {
  describe("sanitizeSpreadsheetText", () => {
    it("neutralizes formula trigger characters (=, +, -, @) on strings", () => {
      expect(sanitizeSpreadsheetText("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(sanitizeSpreadsheetText("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
      expect(sanitizeSpreadsheetText("-CUST001")).toBe("'-CUST001");
      expect(sanitizeSpreadsheetText("@mention")).toBe("'@mention");
      expect(sanitizeSpreadsheetText("\tTAB_TRIGGER")).toBe("'\tTAB_TRIGGER");
      expect(sanitizeSpreadsheetText("\rCR_TRIGGER")).toBe("'\rCR_TRIGGER");
    });

    it("preserves standard alphanumeric invoice numbers and customer names", () => {
      expect(sanitizeSpreadsheetText("INV-2026-0001")).toBe("INV-2026-0001");
      expect(sanitizeSpreadsheetText("CUST-992")).toBe("CUST-992");
      expect(sanitizeSpreadsheetText("Acme Fashion Pvt Ltd")).toBe("Acme Fashion Pvt Ltd");
      expect(sanitizeSpreadsheetText("Cotton Fabric 60s")).toBe("Cotton Fabric 60s");
    });

    it("leaves non-string values untouched", () => {
      expect(sanitizeSpreadsheetText(42)).toBe(42);
      expect(sanitizeSpreadsheetText(-150.5)).toBe(-150.5);
      expect(sanitizeSpreadsheetText(null)).toBe(null);
      expect(sanitizeSpreadsheetText(undefined)).toBe(undefined);
    });
  });

  describe("buildXlsxBuffer with Custom Invoice Data", () => {
    const columns: XlsxColumn[] = [
      { header: "Invoice #", key: "invoiceNumber", width: 18 },
      { header: "Date", key: "invoiceDate", width: 14, type: "date" },
      { header: "Customer Name", key: "customerName", width: 24 },
      { header: "Place of Supply", key: "placeOfSupply", width: 16 },
      { header: "Tax Classification", key: "taxClassification", width: 24 },
      { header: "Subtotal", key: "subtotalAmount", width: 16, type: "number" },
      { header: "CGST", key: "cgstAmount", width: 14, type: "number" },
      { header: "SGST", key: "sgstAmount", width: 14, type: "number" },
      { header: "IGST", key: "igstAmount", width: 14, type: "number" },
      { header: "Total Tax", key: "taxAmount", width: 14, type: "number" },
      { header: "Grand Total", key: "grandTotal", width: 16, type: "number" },
      { header: "Balance Due", key: "balanceDue", width: 16, type: "number" },
    ];

    it("produces a valid Excel spreadsheet with correct types and formulas neutralized", async () => {
      const rows = [
        // Intra-state invoice
        {
          invoiceNumber: sanitizeSpreadsheetText("INV-2026-0001"),
          invoiceDate: new Date("2026-10-14"),
          customerName: sanitizeSpreadsheetText("Vogue Apparel"),
          placeOfSupply: "08",
          taxClassification: "Intra-State (CGST + SGST)",
          subtotalAmount: 1000,
          cgstAmount: 90,
          sgstAmount: 90,
          igstAmount: 0,
          taxAmount: 180,
          grandTotal: 1180,
          balanceDue: 1180,
        },
        // Inter-state invoice
        {
          invoiceNumber: sanitizeSpreadsheetText("INV-2026-0002"),
          invoiceDate: new Date("2026-10-15"),
          customerName: sanitizeSpreadsheetText("Mumbai Trends"),
          placeOfSupply: "27",
          taxClassification: "Inter-State (IGST)",
          subtotalAmount: 2000,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 360,
          taxAmount: 360,
          grandTotal: 2360,
          balanceDue: 1000,
        },
        // Legacy invoice with null GST splits
        {
          invoiceNumber: sanitizeSpreadsheetText("INV-2025-HISTORIC"),
          invoiceDate: new Date("2025-12-01"),
          customerName: sanitizeSpreadsheetText("Old Client"),
          placeOfSupply: "—",
          taxClassification: "Unclassified (Legacy)",
          subtotalAmount: 500,
          cgstAmount: null,
          sgstAmount: null,
          igstAmount: null,
          taxAmount: 50,
          grandTotal: 550,
          balanceDue: 0,
        },
        // Malicious customer name with formula injection attempt and negative adjustment
        {
          invoiceNumber: sanitizeSpreadsheetText("=1+1"),
          invoiceDate: new Date("2026-10-16"),
          customerName: sanitizeSpreadsheetText("@InjectedUser"),
          placeOfSupply: "08",
          taxClassification: "Intra-State (CGST + SGST)",
          subtotalAmount: 100,
          cgstAmount: 9,
          sgstAmount: 9,
          igstAmount: 0,
          taxAmount: 18,
          grandTotal: 118,
          balanceDue: -50.25, // Negative numeric amount (e.g. overpayment/credit)
        },
      ];

      const buffer = await buildXlsxBuffer("Custom Invoices", columns, rows);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      const worksheet = workbook.getWorksheet("Custom Invoices")!;

      expect(worksheet).toBeDefined();
      expect(worksheet.rowCount).toBe(5); // 1 header + 4 rows

      // Check Header
      expect(worksheet.getRow(1).getCell(1).value).toBe("Invoice #");
      expect(worksheet.getRow(1).getCell(1).font?.bold).toBe(true);

      // Row 1 (Intra-state)
      const r1 = worksheet.getRow(2);
      expect(r1.getCell(1).value).toBe("INV-2026-0001");
      expect(r1.getCell(2).value).toBeInstanceOf(Date);
      expect(r1.getCell(6).value).toBe(1000);
      expect(typeof r1.getCell(6).value).toBe("number");
      expect(r1.getCell(7).value).toBe(90);
      expect(r1.getCell(8).value).toBe(90);
      expect(r1.getCell(9).value).toBe(0);

      // Row 2 (Inter-state)
      const r2 = worksheet.getRow(3);
      expect(r2.getCell(1).value).toBe("INV-2026-0002");
      expect(r2.getCell(7).value).toBe(0);
      expect(r2.getCell(8).value).toBe(0);
      expect(r2.getCell(9).value).toBe(360);

      // Row 3 (Legacy: null GST values must be null/empty, not fabricated 0)
      const r3 = worksheet.getRow(4);
      expect(r3.getCell(1).value).toBe("INV-2025-HISTORIC");
      expect(r3.getCell(7).value).toBeNull();
      expect(r3.getCell(8).value).toBeNull();
      expect(r3.getCell(9).value).toBeNull();
      expect(r3.getCell(10).value).toBe(50); // Total tax preserved

      // Row 4 (Formula neutralized values and native negative number)
      const r4 = worksheet.getRow(5);
      expect(r4.getCell(1).value).toBe("'=1+1"); // Neutralized
      expect(r4.getCell(3).value).toBe("'@InjectedUser"); // Neutralized
      expect(r4.getCell(12).value).toBe(-50.25); // Native number preserved
      expect(typeof r4.getCell(12).value).toBe("number");
    });
  });
});

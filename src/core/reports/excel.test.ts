import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildReportXlsxBuffer } from "./excel";
import type { ReportDescriptor } from "./report-types";

function descriptor(overrides: Partial<ReportDescriptor> = {}): ReportDescriptor {
  return {
    title: "Report",
    filtersApplied: [],
    columns: [{ key: "name", label: "Name" }],
    rows: [{ name: "Row 1" }],
    generatedAt: new Date().toISOString(),
    generatedByName: "Test User",
    ...overrides,
  };
}

describe("buildReportXlsxBuffer", () => {
  // Regression test for ERP-BUG-R001/ERP-BUG-Q001 (Phase 10 QA pass): ExcelJS
  // rejects a worksheet name containing any of `* ? : \ / [ ]` — several real
  // report titles have one ("Slow-Moving / Dead Stock", "Customer Outstanding
  // / AR Aging"), which crashed export/xlsx with a raw 500 instead of ever
  // producing a file.
  it("does not throw for a title containing Excel-illegal worksheet-name characters", async () => {
    const buffer = await buildReportXlsxBuffer(descriptor({ title: "Customer Outstanding / AR Aging" }));
    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).not.toMatch(/[*?:\\/[\]]/);
  });

  it("still produces a readable worksheet for an ordinary title", async () => {
    const buffer = await buildReportXlsxBuffer(descriptor({ title: "Sales Register" }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets[0].name).toBe("Sales Register");
  });
});

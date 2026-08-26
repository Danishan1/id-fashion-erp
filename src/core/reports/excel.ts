import ExcelJS from "exceljs";
import type { ReportColumn, ReportDescriptor } from "./report-types";

function excelType(type: ReportColumn["type"]): "date" | "number" | undefined {
  if (type === "date") return "date";
  if (type === "number" || type === "currency" || type === "percent") return "number";
  return undefined;
}

/**
 * Builds a full workbook from one ReportDescriptor — filter-summary block,
 * frozen header row, a totals row when the descriptor has one. Wraps the
 * existing `buildXlsxBuffer`/exceljs conventions (src/lib/xlsx.ts) rather
 * than replacing them; used identically by every report's export/xlsx route.
 */
/** ExcelJS/Excel itself rejects a worksheet name containing any of
 * `* ? : \ / [ ]` — several real report titles have one (e.g. "Slow-Moving
 * / Dead Stock", "Customer Outstanding / AR Aging"), which crashed the
 * export with a raw 500 instead of the standard structured error shape
 * (ERP-BUG-R001/ERP-BUG-Q001, Phase 10 QA pass — confirmed the same root
 * cause behind both independently-reported instances). */
function sanitizeWorksheetName(title: string): string {
  return title.replace(/[*?:\\/[\]]/g, "-").slice(0, 31) || "Report";
}

export async function buildReportXlsxBuffer(descriptor: ReportDescriptor): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sanitizeWorksheetName(descriptor.title));

  let rowCursor = 1;
  worksheet.getCell(rowCursor, 1).value = descriptor.title;
  worksheet.getCell(rowCursor, 1).font = { bold: true, size: 14 };
  rowCursor++;

  if (descriptor.subtitle) {
    worksheet.getCell(rowCursor, 1).value = descriptor.subtitle;
    rowCursor++;
  }

  if (descriptor.filtersApplied.length > 0) {
    const filterText = descriptor.filtersApplied.map((f) => `${f.label}: ${f.value}`).join("  |  ");
    worksheet.getCell(rowCursor, 1).value = `Filters — ${filterText}`;
    worksheet.getCell(rowCursor, 1).font = { italic: true, size: 9 };
    rowCursor++;
  }

  worksheet.getCell(rowCursor, 1).value = `Generated: ${descriptor.generatedAt} by ${descriptor.generatedByName}`;
  worksheet.getCell(rowCursor, 1).font = { italic: true, size: 9 };
  rowCursor += 2;

  const headerRowNumber = rowCursor;
  descriptor.columns.forEach((col, index) => {
    const cell = worksheet.getCell(headerRowNumber, index + 1);
    cell.value = col.label;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  });
  worksheet.columns.forEach((col, index) => {
    const c = descriptor.columns[index];
    worksheet.getColumn(index + 1).width = Math.max(12, (c?.label.length ?? 12) + 4);
  });
  rowCursor++;

  for (const row of descriptor.rows) {
    descriptor.columns.forEach((col, index) => {
      const cell = worksheet.getCell(rowCursor, index + 1);
      const value = row[col.key];
      const type = excelType(col.type);
      if (value === null || value === undefined) {
        cell.value = null;
      } else if (type === "date") {
        cell.value = value instanceof Date ? value : new Date(String(value));
        cell.numFmt = "yyyy-mm-dd";
      } else if (type === "number") {
        cell.value = Number(value);
        if (col.type === "currency") cell.numFmt = "#,##0.00";
        if (col.type === "percent") cell.numFmt = "0.00";
      } else {
        cell.value = String(value);
      }
    });
    rowCursor++;
  }

  if (descriptor.totals) {
    descriptor.columns.forEach((col, index) => {
      const cell = worksheet.getCell(rowCursor, index + 1);
      const value = descriptor.totals?.[col.key];
      if (value === undefined) return;
      cell.font = { bold: true };
      const type = excelType(col.type);
      cell.value = type === "number" ? Number(value) : String(value);
    });
  }

  worksheet.views = [{ state: "frozen", ySplit: headerRowNumber }];

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function reportXlsxHeaders(fileName: string) {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}

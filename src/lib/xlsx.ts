import ExcelJS from "exceljs";

/**
 * Server-side Excel export — the one real caller `exceljs` (already an
 * installed dependency, previously imported nowhere in this codebase) gets.
 * Deliberately NOT client-side like `src/lib/csv.ts`: exceljs needs Node
 * APIs, and generating server-side lets an export run against the FULL
 * filtered result set directly from the DB rather than whatever page is
 * currently loaded in the browser — the "respect current filters, work
 * reliably with larger datasets" requirement.
 */
export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  /** "date" formats a JS Date with a real Excel date format; "number"
   * ensures numeric values aren't coerced to text. Omit for plain strings. */
  type?: "date" | "number";
}

export async function buildXlsxBuffer(sheetName: string, columns: XlsxColumn[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  worksheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const excelRow = worksheet.addRow(row);
    columns.forEach((c, index) => {
      const cell = excelRow.getCell(index + 1);
      const value = row[c.key];
      if (value === null || value === undefined) {
        cell.value = null;
      } else if (c.type === "date") {
        cell.value = value instanceof Date ? value : new Date(String(value));
        cell.numFmt = "yyyy-mm-dd";
      } else if (c.type === "number") {
        cell.value = Number(value);
      }
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function xlsxResponseHeaders(fileName: string) {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}

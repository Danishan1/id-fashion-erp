import ExcelJS from "exceljs";

/**
 * Server-side Excel *read* — the read-side counterpart to `src/lib/xlsx.ts`'s
 * write-side `buildXlsxBuffer`, both using the same already-installed
 * `exceljs` dependency. Used by the Bulk Master Data Import portal to parse
 * an uploaded .xlsx file into the exact same `string[][]` shape
 * `src/lib/csv.ts`'s `parseCsv()` already returns for a .csv upload, so
 * `bulk-import.service.ts`'s row-mapping/validation logic is completely
 * format-agnostic downstream of this function.
 *
 * Only the first worksheet is read (this portal's templates are always
 * single-sheet) — every cell is coerced to a trimmed string via `.text`
 * (exceljs's own formatted-display value, which already renders numbers/
 * dates/formula-results as plain text) so a numeric SKU or an
 * Excel-autoformatted date column comes through identically to how a human
 * would type it into a CSV cell. A fully blank trailing row (a common
 * artifact of Excel's own "used range" padding) is dropped, mirroring
 * `parseCsv`'s own trailing-blank-row handling.
 */
export async function parseXlsxBuffer(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // Cast needed: exceljs's bundled type defs pin a `Buffer` shape from an
  // older @types/node than this project's own, so the two `Buffer` types
  // don't structurally match even though they're identical at runtime.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    const cellCount = Math.max(row.cellCount, row.actualCellCount);
    for (let colIndex = 1; colIndex <= cellCount; colIndex++) {
      const cell = row.getCell(colIndex);
      values.push((cell.text ?? "").trim());
    }
    rows.push(values);
  });

  return rows.filter((r) => r.some((cell) => cell.length > 0));
}

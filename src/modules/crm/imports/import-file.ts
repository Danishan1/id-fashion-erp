import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { parseCsv } from "@/lib/csv";
import { parseXlsxBuffer } from "@/lib/xlsx-read";

/**
 * Reads an uploaded CSV / XLSX into headers + string rows, defensively:
 * - type by extension, then magic bytes (an .xlsx is a ZIP; legacy .xls and
 *   anything binary is rejected with a clear message)
 * - CSV text decoding: UTF-8 (with or without BOM), UTF-16 LE/BE (BOM), and
 *   Windows-1252 as the fallback for files saved by older Excel
 * - delimiter detection (comma, semicolon, tab, pipe) from the header line
 * - empty files, header-only files, missing / blank / repeated headers
 * - size (FileStorage's 20 MB limit) and row limits
 * Nothing in the file is ever executed or evaluated; every cell is plain text.
 */

export const MAX_IMPORT_ROWS = 25_000;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_COLUMNS = 100;

export interface ParsedImportFile {
  fileType: "CSV" | "XLSX";
  mimeType: string;
  headers: string[];
  rows: string[][];
  encoding: string | null;
  delimiter: string | null;
  /** Normalised UTF-8 copy for temporary storage (CSV only). */
  storageBuffer: Buffer;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function invalid(message: string): never {
  throw new BusinessRuleError("VALIDATION_ERROR", message, { fieldErrors: { file: message } });
}

export function decodeCsvText(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return { text: buffer.subarray(3).toString("utf-8"), encoding: "utf-8" };
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buffer.subarray(2)), encoding: "utf-16le" };
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buffer.subarray(2)), encoding: "utf-16be" };
  if (buffer.includes(0)) invalid("This file contains binary data and isn't a valid CSV. Save it as CSV (UTF-8) or XLSX and try again.");
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "windows-1252" };
  }
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t", "|"]) {
    // Count delimiters outside quotes on the header line.
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

const looksLikeData = (cell: string) => /@|^\+?\d[\d\s-]{6,}$/.test(cell.trim());

/** Blank headers → "Column N"; repeated headers get " (2)", " (3)"… so every column stays addressable. */
export function cleanHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = h.replace(/^﻿/, "").replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
    const k = name.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

export function detectFileType(fileName: string, buffer: Buffer): "CSV" | "XLSX" {
  const lower = fileName.toLowerCase();
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isCfb = buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (lower.endsWith(".xls") || isCfb) invalid("Old Excel .xls files aren't supported. In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV, then upload again.");
  if (lower.endsWith(".xlsx")) {
    if (!isZip) invalid("This .xlsx file is damaged or isn't really an Excel workbook.");
    return "XLSX";
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    if (isZip) invalid("This file is a ZIP/Excel workbook with a .csv name. Rename it to .xlsx or export it as CSV.");
    return "CSV";
  }
  invalid("Upload a .csv or .xlsx file.");
}

export async function parseImportFile(fileName: string, buffer: Buffer): Promise<ParsedImportFile> {
  if (buffer.length === 0) invalid("The file is empty.");
  if (buffer.length > MAX_IMPORT_BYTES) invalid(`The file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB. Split it into smaller files.`);
  const fileType = detectFileType(fileName, buffer);

  let table: string[][];
  let encoding: string | null = null;
  let delimiter: string | null = null;
  let storageBuffer = buffer;
  if (fileType === "CSV") {
    const decoded = decodeCsvText(buffer);
    encoding = decoded.encoding;
    delimiter = detectDelimiter(decoded.text);
    table = parseCsv(decoded.text, delimiter).map((r) => r.map((c) => c.trim()));
    if (encoding !== "utf-8") storageBuffer = Buffer.from(decoded.text, "utf-8");
  } else {
    try {
      table = await parseXlsxBuffer(buffer);
    } catch {
      invalid("This Excel file couldn't be read — it may be damaged or password-protected. Open it in Excel, save it again as .xlsx, and retry.");
    }
  }

  table = table.filter((r) => r.some((c) => c && c.length > 0));
  if (table.length === 0) invalid("The file has no data.");
  const [headerRow, ...dataRows] = table;
  if (headerRow.length > MAX_IMPORT_COLUMNS) invalid(`The file has ${headerRow.length} columns; the limit is ${MAX_IMPORT_COLUMNS}.`);
  const nonEmptyHeaders = headerRow.filter((h) => h.trim()).length;
  if (nonEmptyHeaders === 0) invalid("The first row must contain column names (headers).");
  if (headerRow.filter(looksLikeData).length >= Math.max(1, Math.ceil(nonEmptyHeaders / 2))) {
    invalid("The first row looks like data, not column names. Add a header row (e.g. Name, Company, Mobile, Email) and upload again.");
  }
  if (dataRows.length === 0) invalid("The file has a header row but no data rows.");
  if (dataRows.length > MAX_IMPORT_ROWS) invalid(`The file has ${dataRows.length.toLocaleString("en-IN")} rows; one import can have at most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")}. Split it into smaller files.`);

  // Rows wider than the header row keep their extra cells under generated
  // column names — data is never cut off silently.
  const width = Math.min(MAX_IMPORT_COLUMNS, Math.max(headerRow.length, ...dataRows.map((r) => r.length)));
  const paddedHeader = [...headerRow];
  while (paddedHeader.length < width) paddedHeader.push("");
  const headers = cleanHeaders(paddedHeader);

  const rows = dataRows.map((r) => {
    const cells = r.slice(0, width);
    while (cells.length < width) cells.push("");
    return cells;
  });
  return { fileType, mimeType: fileType === "CSV" ? "text/csv" : XLSX_MIME, headers, rows, encoding, delimiter, storageBuffer };
}

import { prisma } from "@/core/db/client";
import { saveFile } from "@/core/file-storage/FileStorage";
import { buildXlsxBuffer, type XlsxColumn } from "@/lib/xlsx";
import { buildSafeCsv, sanitizeSpreadsheetCell } from "./bulk-safety";
import type { BulkItemOutcome } from "./bulk-types";

/**
 * Shared writer for export-type bulk actions (CRM Phase 14, reused by Sales &
 * Marketing Phase 14). Each SUCCEEDED item carries its row (`result.row`);
 * finalize builds one CSV / XLSX in selection order, stores it in the app's
 * private file storage (never under public/), and clears the per-item copies.
 * Every text cell is formula-injection safe.
 */

export const BULK_EXPORT_TTL_DAYS = 7;

export type ExportCell = string | number | Date | null;
export interface ExportColumn {
  header: string;
  type?: "date" | "number";
  width?: number;
}

export function exportRowOutcome(row: ExportCell[] | undefined): BulkItemOutcome {
  if (!row) return { status: "SKIPPED", message: "Not exported: the record no longer exists or is not visible to you." };
  return { status: "SUCCEEDED", result: { row } };
}

export async function writeBulkExportFile(job: { id: string; createdAt: Date }, columns: ExportColumn[], format: "CSV" | "XLSX", pluralLabel: string) {
  const rows: ExportCell[][] = [];
  let cursor = 0;
  for (;;) {
    const batch = await prisma.bulkJobItem.findMany({ where: { jobId: job.id, status: "SUCCEEDED", sequence: { gt: cursor } }, orderBy: { sequence: "asc" }, take: 2000, select: { sequence: true, result: true } });
    if (!batch.length) break;
    for (const it of batch) {
      const row = (it.result as { row?: ExportCell[] } | null)?.row;
      if (row) rows.push(row);
    }
    cursor = batch[batch.length - 1].sequence;
  }
  const stamp = job.createdAt.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const base = `${pluralLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-export-${stamp}`;
  const safe = rows.map((r) =>
    r.map((v, i) => {
      const col = columns[i];
      if (v === null || v === undefined) return null;
      if (col?.type === "date") return format === "XLSX" ? new Date(String(v)) : String(v).slice(0, 10);
      if (col?.type === "number") return typeof v === "number" ? v : Number(v);
      return sanitizeSpreadsheetCell(v);
    })
  );
  let buffer: Buffer;
  let mimeType: string;
  let fileName: string;
  if (format === "XLSX") {
    const xcols: XlsxColumn[] = columns.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width, ...(c.type ? { type: c.type } : {}) }));
    buffer = await buildXlsxBuffer(pluralLabel.slice(0, 31), xcols, safe.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))));
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    fileName = `${base}.xlsx`;
  } else {
    buffer = buildSafeCsv(columns.map((c) => c.header), safe);
    mimeType = "text/csv";
    fileName = `${base}.csv`;
  }
  const stored = await saveFile(buffer, fileName, mimeType);
  // The file is the export now; don't keep a second copy of the data on the items.
  await prisma.bulkJobItem.updateMany({ where: { jobId: job.id, status: "SUCCEEDED" }, data: { result: { exported: true } } });
  const expiresAt = new Date(Date.now() + BULK_EXPORT_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  return { file: { storageKey: stored.storageKey, fileName, mimeType, sizeBytes: stored.fileSizeBytes, rowCount: rows.length, expiresAt } };
}

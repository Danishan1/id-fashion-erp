import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getBulkImportQueue } from "@/core/jobs/queue";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buildXlsxBuffer } from "@/lib/xlsx";
import { buildSafeCsv, sanitizeSpreadsheetCell } from "@/modules/bulk-actions/bulk-safety";
import { commitBulkImport, parseUploadedFile, resolveUploadedFileMimeType, validateBulkImportRows } from "@/modules/import/bulk-import.service";
import { SALES_IMPORT_COLUMNS, SALES_IMPORT_SAMPLE_ROWS } from "@/modules/import/import.schema";
import type { SalesActor } from "../enquiries/sales-enquiry.service";

/**
 * Phase 14 (S&M) — enquiry import screens' service: template, validation
 * preview (dry run, nothing written), commit (queued; rows are created in the
 * worker one by one, a bad row never stops the others), batch history and the
 * failed-rows report. Requires sales_marketing.create (checked by the routes).
 * A user sees their own import batches; S&M administrators see everyone's.
 */

const TYPE = "BUYER_ENQUIRY" as const;
const MAX_ROWS = 2_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function enquiryImportTemplate(format: "csv" | "xlsx") {
  const columns = SALES_IMPORT_COLUMNS[TYPE];
  const sample = SALES_IMPORT_SAMPLE_ROWS[TYPE];
  if (format === "csv") return { fileName: "enquiry-import-template.csv", mimeType: "text/csv; charset=utf-8", buffer: buildSafeCsv(columns.map((c) => c.label), [columns.map((c) => sanitizeSpreadsheetCell(sample[c.key] ?? ""))]) };
  const buffer = await buildXlsxBuffer("Enquiries", columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(18, Math.min(40, c.label.length)) })), [sample]);
  return { fileName: "enquiry-import-template.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer };
}

async function readUpload(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a CSV or Excel file to upload.", { fieldErrors: { file: "Required." } });
  if (file.size > MAX_FILE_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The file is larger than 5 MB. Split it into smaller files.");
  const mimeType = resolveUploadedFileMimeType(file.name, file.type);
  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows, totalRows } = await parseUploadedFile(buffer, mimeType, TYPE);
  if (totalRows > MAX_ROWS) throw new BusinessRuleError("VALIDATION_ERROR", `An enquiry import takes up to ${MAX_ROWS.toLocaleString("en-IN")} rows (this file has ${totalRows.toLocaleString("en-IN")}). Split it.`);
  return { file, mimeType, buffer, rows, totalRows };
}

const importActor = (actor: SalesActor) => ({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null });

/** Validation preview: every row through the real checks, nothing written. */
export async function validateEnquiryImport(actor: SalesActor, form: FormData) {
  const { rows, totalRows } = await readUpload(form);
  const result = await validateBulkImportRows(importActor(actor), TYPE, rows);
  return { ...result, totalRows };
}

/** Re-parses and re-checks the file (never trusts the earlier preview), stores it for audit and queues the import. */
export async function commitEnquiryImport(actor: SalesActor, form: FormData) {
  const { file, mimeType, buffer, rows } = await readUpload(form);
  return commitBulkImport(importActor(actor), TYPE, file.name, buffer, mimeType, rows);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertId = (id: string) => {
  if (!UUID.test(id)) throw new BusinessRuleError("NOT_FOUND", "Import not found.", { id });
};

async function batchScope(actor: SalesActor): Promise<Prisma.ImportBatchWhereInput> {
  const admin = await PermissionService.can(actor.userId, "sales_marketing_settings", "edit");
  return { companyId: actor.companyId, importType: TYPE, ...(admin ? {} : { createdByUserId: actor.userId }) };
}

export async function listEnquiryImportBatches(actor: SalesActor, page: { skip: number; take: number }) {
  const where = await batchScope(actor);
  const [rows, totalCount] = await Promise.all([
    prisma.importBatch.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page.skip,
      take: page.take,
      select: { id: true, fileName: true, totalRows: true, importedCount: true, skippedCount: true, status: true, createdAt: true, failedRowsJson: true, createdBy: { select: { fullName: true } } },
    }),
    prisma.importBatch.count({ where }),
  ]);
  return { data: rows.map(({ failedRowsJson, ...r }) => ({ ...r, hasFailedRows: failedRowsJson !== null })), totalCount };
}

export async function getEnquiryImportBatch(actor: SalesActor, id: string) {
  assertId(id);
  const batch = await prisma.importBatch.findFirst({ where: { AND: [await batchScope(actor), { id }] }, include: { createdBy: { select: { fullName: true } } } });
  if (!batch) throw new BusinessRuleError("NOT_FOUND", "Import not found.", { id });
  let progress: { processed: number; total: number } | null = null;
  if (batch.jobId && (batch.status === "QUEUED" || batch.status === "PROCESSING")) {
    try {
      const job = await getBulkImportQueue().getJob(batch.jobId);
      if (job?.progress && typeof job.progress === "object") progress = job.progress as { processed: number; total: number };
    } catch {
      // Redis unreachable: the database counts still tell the story.
    }
  }
  const failed = (batch.failedRowsJson ?? []) as unknown as { rowNumber: number; reason: string }[];
  return {
    id: batch.id,
    fileName: batch.fileName,
    status: batch.status,
    totalRows: batch.totalRows,
    importedCount: batch.importedCount,
    skippedCount: batch.skippedCount,
    createdAt: batch.createdAt,
    createdBy: batch.createdBy?.fullName ?? null,
    progress,
    failures: failed.slice(0, 200).map((f) => ({ rowNumber: f.rowNumber, reason: f.reason })),
    failureCount: failed.length,
  };
}

/** Failed rows with their own values and the reason — fix and re-upload just these. Formula-safe. */
export async function enquiryImportErrorReport(actor: SalesActor, id: string) {
  assertId(id);
  const batch = await prisma.importBatch.findFirst({ where: { AND: [await batchScope(actor), { id }] } });
  if (!batch) throw new BusinessRuleError("NOT_FOUND", "Import not found.", { id });
  if (!batch.failedRowsJson) throw new BusinessRuleError("VALIDATION_ERROR", "This import has no failed rows.");
  const failed = batch.failedRowsJson as unknown as { rowNumber: number; data: Record<string, string>; reason: string }[];
  const columns = SALES_IMPORT_COLUMNS[TYPE];
  const rows = failed.map((r) => [r.rowNumber, ...columns.map((c) => r.data[c.key] ?? ""), r.reason].map(sanitizeSpreadsheetCell));
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "import_batches", recordId: id, action: "UPDATE", newValues: { downloaded: "error-report", rows: rows.length } });
  return { fileName: `${batch.fileName.replace(/\.[^.]+$/, "")}-errors.csv`, buffer: buildSafeCsv(["Row #", ...columns.map((c) => c.label), "Error"], rows) };
}

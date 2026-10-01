import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ImportBatchType } from "@prisma/client";
import type { ListQuery } from "@/lib/list-query";
import { ImportBatchRepository } from "./import.repository";

// Shared helpers + batch read APIs for the Bulk Master Data Import portal
// (bulk-import.service.ts). The old synchronous CRM/Marketing CSV importer
// (LEAD / DEAL / CAMPAIGN_DAILY_METRIC) that used to live here was removed
// with the CRM and Marketing modules (2026-10-01).

export function messageFromError(error: unknown): string {
  if (error instanceof BusinessRuleError) return error.message;
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    const zodError = error as { issues: { path: (string | number)[]; message: string }[] };
    return zodError.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
  }
  if (error instanceof Error) return error.message;
  return "Import failed for this row.";
}

/** Empty CSV cells become `undefined` (not `""`) for enum-typed fields, so
 * the target create-schema's own `.default(...)` actually applies — Zod's
 * `.default()` only substitutes on `undefined`, an empty string still fails
 * a strict `z.enum(...)` check. Numeric fields don't need this: `Number("")`
 * is `0`, which already matches those schemas' own `.default(0)`. */
export function undefinedIfBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function listImportBatches(companyId: string, query: ListQuery, importTypes?: ImportBatchType[]) {
  const where = {
    companyId,
    ...(importTypes ? { importType: { in: importTypes } } : {}),
    ...(query.search ? { fileName: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    ImportBatchRepository.findMany(where, query.skip, query.take),
    ImportBatchRepository.count(where),
  ]);

  return {
    data: data.map((b) => ({ ...b, hasFailedRows: b.failedRowsJson !== null, failedRowsJson: undefined })),
    totalCount,
  };
}

export async function getImportBatchById(companyId: string, id: string) {
  const batch = await ImportBatchRepository.findByIdWithDetails(companyId, id);
  if (!batch) throw new BusinessRuleError("NOT_FOUND", "Import batch not found.", { id });
  return batch;
}

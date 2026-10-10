import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ImportBatchType, Prisma } from "@prisma/client";
import type { ListQuery } from "@/lib/list-query";
import type { ActorContext } from "@/modules/marketing/campaign.service";
import { recordDailyMetricSchema } from "@/modules/marketing/campaign.schema";
import { recordDailyMetric } from "@/modules/marketing/campaign.service";
import { ImportBatchRepository } from "./import.repository";
import { IMPORT_COLUMNS, type ImportBatchTypeValue, type RunImportInput } from "./import.schema";

// Shared helpers + batch read APIs for the Bulk Master Data Import portal
// (bulk-import.service.ts) AND the old synchronous CRM/Marketing CSV
// importer. LEAD/DEAL row-processing was removed with the legacy CRM
// (2026-10-09, CRM Replacement); CAMPAIGN_DAILY_METRIC's own row-processor
// was restored since Marketing was explicitly kept (see CLAUDE.md's CRM
// Replacement section).

export interface ImportRowFailure {
  rowNumber: number;
  data: Record<string, string>;
  reason: string;
}

export interface RunImportResult {
  batchId: string;
  importType: ImportBatchTypeValue;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedRows: ImportRowFailure[];
}

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

async function resolveCampaignId(companyId: string, campaignNumber: string | undefined, campaignName: string | undefined): Promise<string> {
  const number = undefinedIfBlank(campaignNumber);
  const name = undefinedIfBlank(campaignName);

  if (!number && !name) {
    // Guards a real Prisma footgun, not just a UX nicety: `equals: undefined`
    // is treated by Prisma as "no filter on this field" rather than "match
    // nothing", so leaving both blank would otherwise silently match an
    // arbitrary campaign instead of failing loudly.
    throw new BusinessRuleError("VALIDATION_ERROR", "Either Campaign # or Campaign Name is required to identify the campaign.");
  }

  const campaign = number
    ? await prisma.campaign.findFirst({ where: { companyId, campaignNumber: number }, select: { id: true } })
    : await prisma.campaign.findFirst({ where: { companyId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });

  if (!campaign) {
    throw new BusinessRuleError("NOT_FOUND", `Campaign "${number ?? name}" not found.`);
  }
  return campaign.id;
}

async function importCampaignMetricRow(actor: ActorContext, raw: Record<string, string>) {
  const campaignId = await resolveCampaignId(actor.companyId, raw.campaignNumber, raw.campaignName);

  const input = recordDailyMetricSchema.parse({
    metricDate: raw.metricDate?.trim(),
    spend: raw.spend,
    impressions: raw.impressions,
    clicks: raw.clicks,
    notes: raw.notes?.trim() ?? "",
  });

  await recordDailyMetric(actor, campaignId, input);
}

const IMPORTERS: Record<ImportBatchTypeValue, (actor: ActorContext, raw: Record<string, string>) => Promise<void>> = {
  CAMPAIGN_DAILY_METRIC: importCampaignMetricRow,
};

/**
 * Deliberately per-row isolation, not one all-or-nothing transaction: a CSV
 * import's whole point is "import what's valid, report what isn't" (the
 * plan's own explicit imported/skipped/failed-rows summary), not
 * abort-everything-on-first-bad-row. Every row goes through the exact same
 * schema + service function (recordDailyMetric) the manual UI form uses --
 * same validation and business rules, with zero duplicated logic here.
 */
export async function runImport(actor: ActorContext, input: RunImportInput): Promise<RunImportResult> {
  const importRow = IMPORTERS[input.importType];
  const failedRows: ImportRowFailure[] = [];
  let importedCount = 0;

  for (let i = 0; i < input.rows.length; i++) {
    const raw = input.rows[i];
    try {
      await importRow(actor, raw);
      importedCount++;
    } catch (error) {
      failedRows.push({ rowNumber: i + 1, data: raw, reason: messageFromError(error) });
    }
  }

  const batch = await ImportBatchRepository.create({
    companyId: actor.companyId,
    importType: input.importType,
    fileName: input.fileName,
    totalRows: input.rows.length,
    importedCount,
    skippedCount: failedRows.length,
    failedRowsJson: failedRows.length > 0 ? (failedRows as unknown as Prisma.InputJsonValue) : null,
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "import_batches",
    recordId: batch.id,
    action: "CREATE",
    newValues: { importType: input.importType, fileName: input.fileName, importedCount, skippedCount: failedRows.length },
  });

  return {
    batchId: batch.id,
    importType: input.importType,
    totalRows: input.rows.length,
    importedCount,
    skippedCount: failedRows.length,
    failedRows,
  };
}

export { IMPORT_COLUMNS };

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

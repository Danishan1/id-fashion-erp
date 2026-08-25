import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { Prisma } from "@prisma/client";
import type { ListQuery } from "@/lib/list-query";
import type { ActorContext } from "@/modules/crm/lead.service";
import { createDealSchema } from "@/modules/crm/deal.schema";
import { createDeal } from "@/modules/crm/deal.service";
import { createLeadSchema } from "@/modules/crm/lead.schema";
import { createLead } from "@/modules/crm/lead.service";
import { recordDailyMetricSchema } from "@/modules/marketing/campaign.schema";
import { recordDailyMetric } from "@/modules/marketing/campaign.service";
import { ImportBatchRepository } from "./import.repository";
import { IMPORT_COLUMNS, type ImportBatchTypeValue, type RunImportInput } from "./import.schema";

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

function messageFromError(error: unknown): string {
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
function undefinedIfBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function importLeadRow(actor: ActorContext, raw: Record<string, string>) {
  // Deliberately no manual pre-check for an invalid source here — that used
  // to throw immediately with only that one issue, short-circuiting before
  // createLeadSchema.parse() below got a chance to run and report every
  // issue in the row together (matching importDealRow's own behavior,
  // which has no such pre-check). The schema's own `z.enum(LEAD_SOURCES)`
  // already rejects an invalid value as one Zod issue among however many
  // the row actually has, which messageFromError() then joins into one
  // combined message.
  const source = undefinedIfBlank(raw.source)?.toUpperCase();

  const input = createLeadSchema.parse({
    name: raw.name?.trim(),
    email: raw.email?.trim() ?? "",
    phone: raw.phone?.trim() ?? "",
    companyName: raw.companyName?.trim() ?? "",
    source,
    leadScore: raw.leadScore,
    value: raw.value,
    expectedCloseDate: undefinedIfBlank(raw.expectedCloseDate),
    notes: raw.notes?.trim() ?? "",
  });

  await createLead(actor, input);
}

async function resolveLeadId(companyId: string, leadNumber: string | undefined): Promise<string | undefined> {
  const trimmed = undefinedIfBlank(leadNumber);
  if (!trimmed) return undefined;
  const lead = await prisma.lead.findFirst({ where: { companyId, leadNumber: trimmed }, select: { id: true } });
  if (!lead) throw new BusinessRuleError("NOT_FOUND", `Lead "${trimmed}" not found.`);
  return lead.id;
}

async function resolveCustomerId(companyId: string, customerCode: string | undefined): Promise<string | undefined> {
  const trimmed = undefinedIfBlank(customerCode);
  if (!trimmed) return undefined;
  const customer = await prisma.customer.findFirst({ where: { companyId, code: trimmed }, select: { id: true } });
  if (!customer) throw new BusinessRuleError("NOT_FOUND", `Customer "${trimmed}" not found.`);
  return customer.id;
}

async function importDealRow(actor: ActorContext, raw: Record<string, string>) {
  const [leadId, customerId] = await Promise.all([
    resolveLeadId(actor.companyId, raw.leadNumber),
    resolveCustomerId(actor.companyId, raw.customerCode),
  ]);

  const input = createDealSchema.parse({
    title: raw.title?.trim(),
    leadId,
    customerId,
    value: raw.value,
    probabilityPercent: raw.probabilityPercent,
    expectedCloseDate: undefinedIfBlank(raw.expectedCloseDate),
    notes: raw.notes?.trim() ?? "",
  });

  await createDeal(actor, input);
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
  LEAD: importLeadRow,
  DEAL: importDealRow,
  CAMPAIGN_DAILY_METRIC: importCampaignMetricRow,
};

/**
 * Deliberately per-row isolation, not one all-or-nothing transaction: a CSV
 * import's whole point is "import what's valid, report what isn't" (the
 * plan's own explicit imported/skipped/failed-rows summary), not
 * abort-everything-on-first-bad-row. Every row goes through the exact same
 * schema + service function (createLead/createDeal/recordDailyMetric) the
 * manual UI form uses — same duplicate detection, numbering, audit logging,
 * and business rules, with zero duplicated logic here.
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

export async function listImportBatches(companyId: string, query: ListQuery) {
  const where = {
    companyId,
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

export { IMPORT_COLUMNS };

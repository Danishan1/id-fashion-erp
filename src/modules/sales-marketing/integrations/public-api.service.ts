import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createBulkJob, downloadBulkExport, getBulkJob } from "@/modules/bulk-actions/bulk-jobs.service";
import { attributionReport } from "@/modules/sales-marketing/attribution/attribution-report.service";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";
import { listCampaigns } from "@/modules/sales-marketing/campaigns/campaign.service";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { assertQuotationVisible, listQuotations } from "@/modules/sales-marketing/quotations/quotation.service";
import { listSegments } from "@/modules/sales-marketing/segments/segment.service";
import { SM_API_LIMITS } from "./integration-registry";

/**
 * Phase 16 — the public read model (API v1). Every call goes through the
 * owning module's service as the key's user, so record visibility, branch
 * scope and field permissions are the module's own. The DTOs here are the
 * published contract: explicit, minimal (no owner names, contacts, internal
 * notes or approval internals), stable ids. Adding a field is compatible;
 * removing or renaming one needs a new API version.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Bounded date range: both or neither, from ≤ to, at most a year. */
export function boundedRange(from?: string, to?: string) {
  if (!from && !to) return {};
  if (!from || !to) throw new BusinessRuleError("VALIDATION_ERROR", "Send both from and to.");
  const a = Date.parse(`${isoDate.parse(from)}T00:00:00Z`);
  const b = Date.parse(`${isoDate.parse(to)}T00:00:00Z`);
  if (b < a) throw new BusinessRuleError("VALIDATION_ERROR", "to is before from.");
  if ((b - a) / 86_400_000 > SM_API_LIMITS.maxDateRangeDays) throw new BusinessRuleError("VALIDATION_ERROR", `The range can be at most ${SM_API_LIMITS.maxDateRangeDays} days.`);
  return { from, to };
}

// ── Campaigns ────────────────────────────────────────────────────

export const CAMPAIGN_STATUS_FILTER = z.string().regex(/^[A-Z_,]{1,200}$/).optional();

export async function apiListCampaigns(actor: SalesActor, q: { status?: string; from?: string; to?: string; search?: string }, page: { skip: number; take: number }) {
  const status = CAMPAIGN_STATUS_FILTER.parse(q.status || undefined);
  const r = await listCampaigns(actor, { status, search: q.search?.slice(0, 100), ...boundedRange(q.from, q.to) }, page);
  return {
    total: r.total,
    data: r.data.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      type: c.type,
      objective: c.objective,
      channel: c.channel,
      priority: c.priority,
      plannedStartDate: c.plannedStartDate,
      plannedEndDate: c.plannedEndDate,
      actualStartDate: c.actualStartDate,
      actualEndDate: c.actualEndDate,
      plannedBudget: c.plannedBudget,
      currencyCode: c.currencyCode,
    })),
  };
}

export async function apiGetCampaign(actor: SalesActor, id: string) {
  z.string().uuid().parse(id);
  const c = await getCampaign(actor, id);
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    status: c.status,
    type: c.type?.name ?? null,
    objective: c.objective?.name ?? null,
    channel: c.salesChannel?.name ?? null,
    parent: c.parent ? { id: c.parent.id, code: c.parent.code } : null,
    priority: c.priority,
    plannedStartDate: c.plannedStartDate,
    plannedEndDate: c.plannedEndDate,
    actualStartDate: c.actualStartDate,
    actualEndDate: c.actualEndDate,
    plannedBudget: c.plannedBudget,
    currencyCode: c.currencyCode,
    approvedRevisionNumber: c.approvedRevisionNumber,
    updatedAt: c.updatedAt,
  };
}

// ── Performance (Phase 13 attribution & ROI) ─────────────────────

export async function apiCampaignPerformance(actor: SalesActor, q: { modelId?: string; from?: string; to?: string; basis?: string; campaignId?: string }) {
  if (q.modelId) z.string().uuid().parse(q.modelId);
  if (q.campaignId) z.string().uuid().parse(q.campaignId);
  const r = await attributionReport(actor, { modelId: q.modelId || undefined, campaignId: q.campaignId || undefined, basis: q.basis || undefined, ...boundedRange(q.from, q.to) });
  return {
    model: r.model ? { id: r.model.id, code: r.model.code, name: r.model.name, version: r.model.version } : null,
    basis: r.basis,
    period: r.period,
    calculatedAt: r.run ? r.run.finishedAt : null,
    campaigns: r.rows.map((row) => ({
      campaignId: row.campaignId,
      code: row.code,
      name: row.name,
      messagesSent: row.messagesSent,
      messagesDelivered: row.messagesDelivered,
      responses: row.campaignResponses,
      credited: row.credited,
      attributedRevenue: row.revenue,
      actualSpend: row.actualSpend,
      roiPercent: row.roi.value,
      roiStatus: row.roi.status,
      roas: row.roas.value,
    })),
    notices: r.quality.notices,
  };
}

// ── Segments (metadata only — never members) ─────────────────────

export async function apiListSegments(actor: SalesActor, q: { status?: string; search?: string }, page: { page: number; pageSize: number }) {
  const r = await listSegments(actor, { status: q.status || undefined, search: q.search?.slice(0, 100) || undefined }, page.page, page.pageSize);
  return {
    total: r.meta.totalCount,
    data: r.data.map((s) => ({ id: s.id, code: s.code, name: s.name, sourceType: s.sourceType, segmentType: s.segmentType, status: s.status, memberCount: s.memberCount, lastEvaluatedAt: s.lastEvaluatedAt, lastEvaluationStatus: s.lastEvaluationStatus, version: s.currentVersionNumber })),
  };
}

// ── Quotations ───────────────────────────────────────────────────

export async function apiListQuotations(actor: SalesActor, q: { status?: string; customerId?: string; enquiryId?: string; updatedSince?: string }, page: { skip: number; take: number }) {
  if (q.customerId) z.string().uuid().parse(q.customerId);
  if (q.enquiryId) z.string().uuid().parse(q.enquiryId);
  if (q.updatedSince) z.string().datetime({ offset: true }).parse(q.updatedSince);
  const r = await listQuotations(actor, { status: q.status || undefined, customerId: q.customerId || "", buyerEnquiryId: q.enquiryId || "", view: "all" }, { sortBy: "updatedAt", sortOrder: "desc" }, page);
  const rows = q.updatedSince ? r.data.filter((x) => x.updatedAt >= new Date(q.updatedSince!)) : r.data;
  return {
    total: r.totalCount,
    data: rows.map((x) => ({
      id: x.id,
      number: x.quotationNumber,
      status: x.status,
      revisionNumber: x.currentRevisionNumber,
      customer: x.customer ? { id: x.customer.id, name: x.customer.name } : null,
      enquiryId: x.buyerEnquiry?.id ?? null,
      quotationDate: x.current ? day(x.current.quotationDate) : null,
      validUntil: x.current ? day(x.current.validUntil) : null,
      currencyCode: x.current?.currencyCode ?? null,
      grandTotal: n(x.current?.grandTotal),
      updatedAt: iso(x.updatedAt),
    })),
  };
}

export async function apiGetQuotation(actor: SalesActor, id: string) {
  z.string().uuid().parse(id);
  await assertQuotationVisible(actor, id);
  const q = await prisma.quotation.findFirstOrThrow({
    where: { id, companyId: actor.companyId },
    select: {
      id: true,
      quotationNumber: true,
      status: true,
      currentRevisionNumber: true,
      updatedAt: true,
      customer: { select: { id: true, name: true } },
      buyerEnquiryId: true,
      revisions: {
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: {
          revisionNumber: true,
          status: true,
          quotationDate: true,
          validUntil: true,
          currencyCode: true,
          subtotalAmount: true,
          discountTotal: true,
          taxableTotal: true,
          chargesTotal: true,
          taxTotal: true,
          grandTotal: true,
          lines: { orderBy: { lineNumber: "asc" }, select: { lineNumber: true, lineType: true, productId: true, description: true, quantity: true, unitPrice: true, discountPercent: true, gstRate: true, taxableAmount: true, taxAmount: true, lineTotal: true, requestedDeliveryDate: true } },
        },
      },
    },
  });
  const order = await prisma.salesOrder.findFirst({ where: { companyId: actor.companyId, sourceQuotationRevision: { quotationId: id } }, select: { id: true, orderNumber: true, status: true } });
  const r = q.revisions[0];
  return {
    id: q.id,
    number: q.quotationNumber,
    status: q.status,
    customer: q.customer,
    enquiryId: q.buyerEnquiryId,
    updatedAt: q.updatedAt.toISOString(),
    revision: r
      ? {
          number: r.revisionNumber,
          status: r.status,
          quotationDate: day(r.quotationDate),
          validUntil: day(r.validUntil),
          currencyCode: r.currencyCode,
          totals: { subtotal: n(r.subtotalAmount), discount: n(r.discountTotal), taxable: n(r.taxableTotal), charges: n(r.chargesTotal), tax: n(r.taxTotal), grandTotal: n(r.grandTotal) },
          lines: r.lines.map((l) => ({ lineNumber: l.lineNumber, lineType: l.lineType, styleId: l.productId, description: l.description, quantity: n(l.quantity), unitPrice: n(l.unitPrice), discountPercent: n(l.discountPercent), gstRate: n(l.gstRate), taxableAmount: n(l.taxableAmount), taxAmount: n(l.taxAmount), lineTotal: n(l.lineTotal), requestedDeliveryDate: day(l.requestedDeliveryDate) })),
        }
      : null,
    salesOrder: order ? { id: order.id, number: order.orderNumber, status: order.status } : null,
  };
}

// ── Exports and job status (Phase 14 engine) ─────────────────────

export const EXPORTABLE = { ENQUIRY: "enquiry.export", QUOTATION: "quotation.export", CAMPAIGN: "campaign.export", PROMOTION: "promotion.export" } as const;
const exportSchema = z
  .object({
    recordType: z.enum(Object.keys(EXPORTABLE) as [keyof typeof EXPORTABLE, ...(keyof typeof EXPORTABLE)[]]),
    // The same filter string the ERP list uses (e.g. "view=all&status=OPEN"); empty = the list's default view.
    filter: z.string().max(1000).optional().default(""),
    format: z.enum(["CSV", "XLSX"]).default("CSV"),
  })
  .strict();

/** Starts an export as the key's user — the Phase 14 job applies that user's visibility and export permission. */
export async function apiStartExport(actor: SalesActor, raw: unknown, idempotencyKey: string | null) {
  const input = exportSchema.parse(raw);
  const job = await createBulkJob(
    { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
    { entityType: input.recordType, actionKey: EXPORTABLE[input.recordType], selection: { mode: "FILTER", filterQuery: input.filter }, params: { format: input.format }, ...(idempotencyKey ? { idempotencyKey: `api:${idempotencyKey}`.slice(0, 100) } : {}) }
  );
  return { jobId: job.id, status: job.status };
}

/** Only jobs this key's user started (never other people's jobs, even for admins). */
export async function apiGetJob(actor: SalesActor, id: string) {
  z.string().uuid().parse(id);
  const job = await getBulkJob({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, id);
  if (!job.isMine) throw new BusinessRuleError("NOT_FOUND", "Job not found.");
  return {
    id: job.id,
    recordType: job.entityType,
    action: job.actionKey,
    status: job.status,
    total: job.totalCount,
    succeeded: job.succeededCount,
    failed: job.failedCount,
    skipped: job.skippedCount,
    createdAt: iso(job.createdAt),
    finishedAt: iso(job.finishedAt),
    file: job.download && job.download.available ? { name: job.download.fileName, rows: job.download.rowCount, sizeBytes: job.download.sizeBytes, expiresAt: job.download.expiresAt } : null,
  };
}

export async function apiDownloadJobFile(actor: SalesActor, id: string) {
  z.string().uuid().parse(id);
  return downloadBulkExport({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, id);
}

import { Prisma, type MarketingAttributionRun } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { toIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { campaignScopeWhere, getCampaignScope } from "@/modules/sales-marketing/campaigns/campaign-common";
import { measureBudgets } from "@/modules/sales-marketing/budgets/budget.service";
import { costPer, roas, roiPercent } from "./attribution-math";
import { CONVERSION_TYPE_KEYS, MAX_REPORT_DAYS, REVENUE_BASES, reportQuerySchema, type ConversionType, type RevenueBasis } from "./attribution-registry";
import { rulesOf } from "./attribution-model.service";
import { runChangesSince } from "./attribution-run.service";
import { syncStatus } from "./attribution-sync.service";

/**
 * Attribution & ROI reporting (Phase 13). Reads the newest COMPLETED run of
 * each model's current approved version — never recalculates on read.
 *
 *   Credited conversions  Σ credit weights (a conversion shared by two campaigns counts ½ each)
 *   Attributed revenue    Σ money credits on the chosen basis (order value / invoiced value / accepted quote value), before GST
 *   Actual spend          Phase 12 actual (approved expenses + posted purchase invoices) dated in the period; budgets and commitments are not spend
 *   ROI (revenue-based)   (attributed revenue − actual spend) ÷ actual spend × 100 — not profit; none when spend is 0 / unknown
 *   ROAS                  attributed revenue ÷ actual spend; same rule
 *   Cost per X            actual spend ÷ credited X conversions
 *   Coverage              attributed ÷ (attributed + unattributed) conversions in the period
 */

const DAY_MS = 86_400_000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: Prisma.Decimal | number | bigint | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const CREDIT_COL: Record<RevenueBasis, Prisma.Sql> = {
  ORDER_VALUE: Prisma.sql`cr.order_credit`,
  INVOICED_VALUE: Prisma.sql`cr.invoiced_credit`,
  QUOTED_VALUE: Prisma.sql`cr.quoted_credit`,
};

/** The run reports use for a model: newest completed run of its current approved version. */
export async function currentRun(companyId: string, model: { id: string; approvedVersionId: string | null }) {
  if (!model.approvedVersionId) return null;
  return prisma.marketingAttributionRun.findFirst({ where: { companyId, modelId: model.id, modelVersionId: model.approvedVersionId, status: "COMPLETED" }, orderBy: { finishedAt: "desc" } });
}

async function pickModel(actor: SalesActor, modelId?: string) {
  const m = modelId
    ? await prisma.marketingAttributionModel.findFirst({ where: { id: modelId, companyId: actor.companyId }, include: { approvedVersion: true } })
    : ((await prisma.marketingAttributionModel.findFirst({ where: { companyId: actor.companyId, isDefault: true }, include: { approvedVersion: true } })) ??
      (await prisma.marketingAttributionModel.findFirst({ where: { companyId: actor.companyId, status: "ACTIVE" }, orderBy: { name: "asc" }, include: { approvedVersion: true } })));
  if (modelId && !m) throw new BusinessRuleError("NOT_FOUND", "Attribution model not found.", { id: modelId });
  return m;
}

function clampPeriod(run: MarketingAttributionRun, from?: string, to?: string) {
  const runFrom = toIsoDate(run.periodFrom);
  const runTo = toIsoDate(run.periodTo);
  const f = from && from > runFrom ? from : runFrom;
  const t = to && to < runTo ? to : runTo;
  if (t < f) throw new BusinessRuleError("VALIDATION_ERROR", "The period ends before it starts.");
  if ((Date.parse(t) - Date.parse(f)) / DAY_MS > MAX_REPORT_DAYS) throw new BusinessRuleError("VALIDATION_ERROR", `Report at most ${MAX_REPORT_DAYS} days at a time.`);
  return { from: f, to: t, partial: Boolean((from && from < runFrom) || (to && to > runTo)) };
}

async function creditsByCampaign(run: MarketingAttributionRun, from: string, to: string, basis: RevenueBasis) {
  const rows = await prisma.$queryRaw<{ campaign_id: string; conversion_type: string; credit: Prisma.Decimal; revenue: Prisma.Decimal | null; conversions: bigint }[]>`
    SELECT cr.campaign_id, c.conversion_type, SUM(cr.weight) AS credit, SUM(${CREDIT_COL[basis]}) AS revenue, COUNT(DISTINCT cr.result_id) AS conversions
    FROM marketing_attribution_credits cr
    JOIN marketing_attribution_results r ON r.id = cr.result_id
    JOIN marketing_conversions c ON c.id = r.conversion_id
    WHERE cr.run_id = ${run.id}::uuid AND r.status = 'ATTRIBUTED'
      AND c.business_date BETWEEN ${from}::date AND ${to}::date
    GROUP BY cr.campaign_id, c.conversion_type`;
  return rows;
}

async function resultTotals(run: MarketingAttributionRun, from: string, to: string) {
  const rows = await prisma.$queryRaw<{ conversion_type: string; status: string; n: bigint }[]>`
    SELECT c.conversion_type, r.status, COUNT(*) AS n
    FROM marketing_attribution_results r JOIN marketing_conversions c ON c.id = r.conversion_id
    WHERE r.run_id = ${run.id}::uuid AND c.business_date BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2`;
  const out = Object.fromEntries(CONVERSION_TYPE_KEYS.map((k) => [k, { attributed: 0, unattributed: 0, excluded: 0 }])) as Record<ConversionType, { attributed: number; unattributed: number; excluded: number }>;
  for (const r of rows) {
    const t = out[r.conversion_type as ConversionType];
    if (!t) continue;
    if (r.status === "ATTRIBUTED") t.attributed = Number(r.n);
    else if (r.status === "UNATTRIBUTED") t.unattributed = Number(r.n);
    else t.excluded = Number(r.n);
  }
  return out;
}

async function touchCounts(companyId: string, campaignIds: string[], from: string, to: string) {
  if (!campaignIds.length) return new Map<string, { sent: number; delivered: number; responses: number }>();
  const rows = await prisma.marketingTouchpoint.groupBy({
    by: ["campaignId", "touchpointType"],
    where: { companyId, campaignId: { in: campaignIds }, status: "VALID", occurredAt: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(Date.parse(`${to}T00:00:00Z`) + DAY_MS) } },
    _count: { _all: true },
  });
  const out = new Map<string, { sent: number; delivered: number; responses: number }>();
  for (const r of rows) {
    const t = out.get(r.campaignId) ?? { sent: 0, delivered: 0, responses: 0 };
    if (r.touchpointType === "MESSAGE_DELIVERED") {
      t.delivered += r._count._all;
      t.sent += r._count._all; // delivered messages were sent too
    } else if (r.touchpointType === "MESSAGE_SENT") t.sent += r._count._all;
    else t.responses += r._count._all;
    out.set(r.campaignId, t);
  }
  return out;
}

/** Campaign rows of the attribution & ROI report for the campaigns the viewer can see. */
export async function attributionReport(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "view");
  const q = reportQuerySchema.parse(raw ?? {});
  const model = await pickModel(actor, q.modelId);
  const models = await prisma.marketingAttributionModel.findMany({ where: { companyId: actor.companyId, status: { not: "DRAFT" } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, code: true, name: true, status: true, isDefault: true } });
  const sync = await syncStatus(actor.companyId);
  const basis = q.basis;
  const base = { models, sync, basis, basisLabel: REVENUE_BASES[basis].label, basisHelp: REVENUE_BASES[basis].help };
  if (!model) return { ...base, model: null, run: null, period: null, rows: [], totals: null, channels: [], quality: { notices: ["No attribution model is in use yet. Create one, have it approved, then calculate."] } };
  const run = await currentRun(actor.companyId, model);
  const modelView = { id: model.id, code: model.code, name: model.name, status: model.status, version: model.approvedVersion?.versionNumber ?? null, rules: model.approvedVersion ? rulesOf(model.approvedVersion) : null };
  if (!run) return { ...base, model: modelView, run: null, period: null, rows: [], totals: null, channels: [], quality: { notices: ["This model hasn't been calculated with its current rules yet. Use Recalculate."] } };

  const period = clampPeriod(run, q.from, q.to);
  const scope = await getCampaignScope(actor);
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { AND: [campaignScopeWhere(actor, scope), q.campaignId ? { id: q.campaignId } : {}] },
    select: { id: true, code: true, name: true, status: true, plannedBudget: true, approvedRevisionNumber: true },
  });
  const visible = new Map(campaigns.map((c) => [c.id, c]));
  const [credits, totalsByType, changes, compare] = await Promise.all([
    creditsByCampaign(run, period.from, period.to, basis),
    resultTotals(run, period.from, period.to),
    runChangesSince(run),
    q.compareModelId ? compareCredits(actor, q.compareModelId, period.from, period.to, basis) : Promise.resolve(null),
  ]);
  const basisType = REVENUE_BASES[basis].conversion;
  const involved = [...new Set(credits.map((c) => c.campaign_id).filter((id) => visible.has(id)))];
  const ids = q.campaignId ? (visible.has(q.campaignId) ? [q.campaignId] : []) : involved;
  const [touches, budgets] = await Promise.all([
    touchCounts(actor.companyId, ids, period.from, period.to),
    measureBudgets(actor.companyId, ids.map((id) => visible.get(id)!), prisma, { from: new Date(`${period.from}T00:00:00Z`), to: new Date(`${period.to}T00:00:00Z`) }),
  ]);

  const rows = ids.map((id) => {
    const c = visible.get(id)!;
    const mine = credits.filter((x) => x.campaign_id === id);
    const credited = Object.fromEntries(CONVERSION_TYPE_KEYS.map((k) => [k, r2(num(mine.find((x) => x.conversion_type === k)?.credit))])) as Record<ConversionType, number>;
    const revenueRow = mine.find((x) => x.conversion_type === basisType);
    const revenue = revenueRow ? r2(num(revenueRow.revenue)) : 0;
    const b = budgets.get(id)!;
    const spend = b.actual;
    const t = touches.get(id) ?? { sent: 0, delivered: 0, responses: 0 };
    const cmp = compare?.byCampaign.get(id);
    return {
      campaignId: id,
      code: c.code,
      name: c.name,
      status: c.status,
      messagesSent: t.sent,
      messagesDelivered: t.delivered,
      campaignResponses: t.responses,
      credited,
      revenue,
      actualSpend: spend,
      committed: b.committed,
      costPerLead: costPer(spend, credited.LEAD_CREATED),
      costPerEnquiry: costPer(spend, credited.ENQUIRY_CREATED),
      costPerOrder: costPer(spend, credited.SALES_ORDER_BOOKED),
      roi: roiPercent(revenue, spend),
      roas: roas(revenue, spend),
      compare: cmp ? { credited: r2(cmp.credited), revenue: r2(cmp.revenue) } : compare ? { credited: 0, revenue: 0 } : null,
    };
  });
  rows.sort((a, b) => b.revenue - a.revenue || b.credited.SALES_ORDER_BOOKED - a.credited.SALES_ORDER_BOOKED || a.code.localeCompare(b.code));

  const all = Object.values(totalsByType).reduce((s, t) => ({ attributed: s.attributed + t.attributed, unattributed: s.unattributed + t.unattributed, excluded: s.excluded + t.excluded }), { attributed: 0, unattributed: 0, excluded: 0 });
  const hiddenCampaigns = credits.some((c) => !visible.has(c.campaign_id));
  const revenue = r2(rows.reduce((s, r) => s + r.revenue, 0));
  const spend = r2(rows.reduce((s, r) => s + r.actualSpend, 0));
  const notices: string[] = [];
  if (period.partial) notices.push(`The run covers ${toIsoDate(run.periodFrom)} – ${toIsoDate(run.periodTo)}; the report is limited to that.`);
  if (changes.conversions + changes.touchpoints > 0) notices.push(`Out of date: ${changes.conversions} conversion(s) and ${changes.touchpoints} touchpoint(s) changed after this run's data cut. Recalculate to include them.`);
  if (hiddenCampaigns) notices.push("Some credit went to campaigns you can't see; they aren't listed.");
  if (rows.some((r) => r.revenue > 0 && r.actualSpend <= 0)) notices.push("Campaigns with no actual spend dated in the period show no ROI — link their expenses or invoices on the campaign's Budget panel.");
  if (rows.some((r) => r.committed > 0)) notices.push("Some campaigns have purchase orders not yet invoiced (committed). That spend isn't in ROI until it is invoiced.");
  const summary = run.summary as { noIdentity?: number; noValue?: number; unreconciled?: number };
  if ((summary.unreconciled ?? 0) > 0) notices.push(`${summary.unreconciled} conversion(s) had credits that didn't add up exactly — please report this.`);
  return {
    ...base,
    model: modelView,
    run: { id: run.id, from: toIsoDate(run.periodFrom), to: toIsoDate(run.periodTo), finishedAt: run.finishedAt?.toISOString() ?? null, dataCut: run.sourcesSyncedAt?.toISOString() ?? null, trigger: run.trigger },
    period,
    rows,
    totals: {
      byType: totalsByType,
      attributed: all.attributed,
      unattributed: all.unattributed,
      excluded: all.excluded,
      coveragePercent: all.attributed + all.unattributed > 0 ? Math.round((all.attributed / (all.attributed + all.unattributed)) * 1000) / 10 : null,
      revenue,
      actualSpend: spend,
      roi: roiPercent(revenue, spend),
      roas: roas(revenue, spend),
    },
    channels: await channelBreakdown(run, period.from, period.to, basis, [...visible.keys()]),
    compareModel: compare?.model ?? null,
    quality: { notices, noIdentity: summary.noIdentity ?? 0, noValue: summary.noValue ?? 0, changes },
  };
}

async function compareCredits(actor: SalesActor, modelId: string, from: string, to: string, basis: RevenueBasis) {
  const m = await prisma.marketingAttributionModel.findFirst({ where: { id: modelId, companyId: actor.companyId } });
  if (!m) throw new BusinessRuleError("NOT_FOUND", "Comparison model not found.", { id: modelId });
  const run = await currentRun(actor.companyId, m);
  const byCampaign = new Map<string, { credited: number; revenue: number }>();
  if (run) {
    const rows = await creditsByCampaign(run, from, to, basis);
    const basisType = REVENUE_BASES[basis].conversion;
    for (const r of rows.filter((x) => x.conversion_type === basisType)) byCampaign.set(r.campaign_id, { credited: num(r.credit), revenue: num(r.revenue) });
  }
  return { model: { id: m.id, code: m.code, name: m.name, runId: run?.id ?? null, runPeriod: run ? `${toIsoDate(run.periodFrom)} – ${toIsoDate(run.periodTo)}` : null }, byCampaign };
}

async function channelBreakdown(run: MarketingAttributionRun, from: string, to: string, basis: RevenueBasis, visibleIds: string[]) {
  if (!visibleIds.length) return [];
  const basisType = REVENUE_BASES[basis].conversion;
  const rows = await prisma.$queryRaw<{ channel: string | null; touch: string; credit: Prisma.Decimal; revenue: Prisma.Decimal | null }[]>`
    SELECT cr.channel_type AS channel, cr.touchpoint_type AS touch, SUM(cr.weight) AS credit, SUM(${CREDIT_COL[basis]}) AS revenue
    FROM marketing_attribution_credits cr
    JOIN marketing_attribution_results r ON r.id = cr.result_id
    JOIN marketing_conversions c ON c.id = r.conversion_id
    WHERE cr.run_id = ${run.id}::uuid AND r.status = 'ATTRIBUTED' AND c.conversion_type = ${basisType}
      AND c.business_date BETWEEN ${from}::date AND ${to}::date
      AND cr.campaign_id IN (${Prisma.join(visibleIds.map((id) => Prisma.sql`${id}::uuid`))})
    GROUP BY 1, 2 ORDER BY 1 NULLS LAST, 2`;
  return rows.map((r) => ({ channel: r.channel, touchpointType: r.touch, credited: r2(num(r.credit)), revenue: r2(num(r.revenue)) }));
}

// ── Drill-down ─────────────────────────────────────────────────────

const DOC_PERMISSION: Record<ConversionType, { module: "crm" | "sales_marketing" | "sales_quotations" | "sales_orders"; href: (sourceId: string) => string }> = {
  LEAD_CREATED: { module: "crm", href: (id) => `/crm/leads/${id}` },
  ENQUIRY_CREATED: { module: "sales_marketing", href: (id) => `/sales-marketing/enquiries/${id}` },
  QUOTATION_ACCEPTED: { module: "sales_quotations", href: (id) => `/sales-marketing/quotations/${id}` },
  SALES_ORDER_BOOKED: { module: "sales_orders", href: (id) => `/sales-orders/${id}` },
};

/**
 * The conversions credited to one campaign in the current run, with every touch
 * that shared each one. Record numbers / links only for modules the viewer can
 * open; money only for viewers of that record type. No contact names or addresses.
 */
export async function campaignAttributionDetail(actor: SalesActor, campaignId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "view");
  const q = reportQuerySchema.parse(raw ?? {});
  const scope = await getCampaignScope(actor);
  const campaign = await prisma.marketingCampaign.findFirst({ where: { AND: [{ id: campaignId }, campaignScopeWhere(actor, scope)] }, select: { id: true, code: true, name: true } });
  if (!campaign) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id: campaignId });
  const model = await pickModel(actor, q.modelId);
  if (!model) return { campaign, model: null, run: null, conversions: [] };
  const run = await currentRun(actor.companyId, model);
  if (!run) return { campaign, model: { id: model.id, code: model.code, name: model.name }, run: null, conversions: [] };
  const period = clampPeriod(run, q.from, q.to);
  const allowed = Object.fromEntries(
    await Promise.all((Object.keys(DOC_PERMISSION) as ConversionType[]).map(async (k) => [k, await PermissionService.can(actor.userId, DOC_PERMISSION[k].module, "view")] as const))
  ) as Record<ConversionType, boolean>;
  const mine = await prisma.marketingAttributionCredit.findMany({
    where: { runId: run.id, campaignId, result: { status: "ATTRIBUTED", conversion: { businessDate: { gte: new Date(`${period.from}T00:00:00Z`), lte: new Date(`${period.to}T00:00:00Z`) } } } },
    orderBy: { result: { conversionAt: "desc" } },
    take: 300,
    select: {
      resultId: true,
      weight: true,
      quotedCredit: true,
      orderCredit: true,
      invoicedCredit: true,
      result: {
        select: {
          conversionAt: true,
          quotedValue: true,
          orderValue: true,
          invoicedValue: true,
          conversion: { select: { id: true, conversionType: true, sourceId: true, reference: true, businessDate: true } },
          credits: { orderBy: { position: "asc" }, select: { campaignId: true, touchpointType: true, channelType: true, position: true, weight: true, touchpoint: { select: { occurredAt: true, sourceType: true } } } },
        },
      },
    },
  });
  const otherIds = [...new Set(mine.flatMap((c) => c.result.credits.map((x) => x.campaignId)))];
  const visibleCampaigns = new Map(
    (await prisma.marketingCampaign.findMany({ where: { AND: [{ id: { in: otherIds } }, campaignScopeWhere(actor, scope)] }, select: { id: true, code: true } })).map((c) => [c.id, c.code])
  );
  const money = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
  return {
    campaign,
    model: { id: model.id, code: model.code, name: model.name, version: model.approvedVersion?.versionNumber ?? null },
    run: { id: run.id, from: toIsoDate(run.periodFrom), to: toIsoDate(run.periodTo), finishedAt: run.finishedAt?.toISOString() ?? null },
    period,
    truncated: mine.length === 300,
    conversions: mine.map((c) => {
      const conv = c.result.conversion;
      const type = conv.conversionType as ConversionType;
      const canOpen = allowed[type];
      return {
        resultId: c.resultId,
        conversionType: type,
        reference: canOpen ? conv.reference : "Hidden — no access",
        href: canOpen ? DOC_PERMISSION[type].href(conv.sourceId) : null,
        date: toIsoDate(conv.businessDate),
        weight: Number(c.weight),
        values: canOpen
          ? { quoted: money(c.result.quotedValue), order: money(c.result.orderValue), invoiced: money(c.result.invoicedValue), quotedCredit: money(c.quotedCredit), orderCredit: money(c.orderCredit), invoicedCredit: money(c.invoicedCredit) }
          : null,
        touches: c.result.credits.map((t) => ({
          campaign: visibleCampaigns.get(t.campaignId) ?? "Another campaign",
          thisCampaign: t.campaignId === campaignId,
          touchpointType: t.touchpointType,
          channelType: t.channelType,
          source: t.touchpoint.sourceType,
          at: t.touchpoint.occurredAt.toISOString(),
          position: t.position,
          weight: Number(t.weight),
        })),
      };
    }),
  };
}

/** Run detail: counts, data-quality summary, what changed since its data cut. */
export async function getRun(actor: SalesActor, runId: string) {
  await PermissionService.assert(actor.userId, "marketing_attribution", "view");
  const run = await prisma.marketingAttributionRun.findFirst({ where: { id: runId, companyId: actor.companyId }, include: { model: { select: { id: true, code: true, name: true } }, modelVersion: true } });
  if (!run) throw new BusinessRuleError("NOT_FOUND", "Run not found.", { id: runId });
  return {
    id: run.id,
    model: run.model,
    version: run.modelVersion.versionNumber,
    rules: rulesOf(run.modelVersion),
    status: run.status,
    trigger: run.trigger,
    from: toIsoDate(run.periodFrom),
    to: toIsoDate(run.periodTo),
    counts: { conversions: run.conversions, attributed: run.attributed, unattributed: run.unattributed, excluded: run.excluded },
    summary: run.summary,
    error: run.error,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    dataCut: run.sourcesSyncedAt?.toISOString() ?? null,
    changesSince: run.status === "COMPLETED" ? await runChangesSince(run) : null,
  };
}

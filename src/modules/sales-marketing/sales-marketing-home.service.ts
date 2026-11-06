import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { runGovernedQuery, type ReportResult } from "./analytics/analytics-engine";
import { datasetFreshness, type Freshness } from "./analytics/analytics-freshness";
import { PERIOD_PRESETS, indiaToday, resolvePreset, type PeriodPreset } from "./analytics/analytics-periods";
import { DATASETS, METRIC_BY_ID, type ReportQueryInput } from "./analytics/analytics-registry";
import { campaignScopeWhere, getCampaignScope } from "./campaigns/campaign-common";
import { getSalesEnquiryScope, scopedWhere as enquiryScopedWhere, type SalesActor } from "./enquiries/sales-enquiry.service";
import { OPEN_STAGE_KEYS } from "./enquiries/sales-enquiry-registry";
import { getQuotationScope, scopedWhere as quotationScopedWhere } from "./quotations/quotation.service";
import { SM_BULK_ENTITIES } from "./bulk/sm-bulk-entities";

/**
 * The Sales & Marketing home dashboard (final module dashboard, 2026-11-06).
 *
 * Every figure comes from the Phase 17 governed engine (same metric ids and
 * definitions as Analytics, so the numbers always match) or from the module's
 * own record lists, in the viewer's own scope. The Analytics module itself is
 * not required: a tile needs only its source module, and a tile the viewer
 * can't see is returned as HIDDEN with the reason — never as zero.
 *
 * Sections: headline KPIs vs the previous period, bookings trend, funnel;
 * work queue (things to act on, with links); team & targets; system health.
 */

export const homeQuerySchema = z.object({ preset: z.enum(Object.keys(PERIOD_PRESETS) as [PeriodPreset, ...PeriodPreset[]]).default("this_month") }).strict();

export type Tile<T = ReportResult> = { status: "OK"; result: T } | { status: "HIDDEN" | "ERROR"; message: string };

export interface KpiTile {
  key: string;
  metricId: string;
  label: string;
  unit: string;
  higherIsBetter?: boolean;
  description: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  href: string;
  /** Builder link with this exact query (opens in Analytics for people who have it). */
  query: ReportQueryInput;
}
export interface QueueItem {
  key: string;
  label: string;
  count: number;
  tone: "red" | "amber" | "indigo";
  href: string;
  hint: string;
}
export interface HealthItem {
  key: string;
  label: string;
  status: "OK" | "WARN" | "FAIL" | "UNKNOWN";
  detail: string;
  href: string;
}

const KPIS: { key: string; dataset: string; metric: string; href: string }[] = [
  { key: "booked", dataset: "orders", metric: "booked_order_value", href: "/sales-orders" },
  { key: "invoiced", dataset: "invoices", metric: "invoiced_value", href: "/accounts/sales-invoices" },
  { key: "cash", dataset: "payments", metric: "cash_collected", href: "/accounts/payments" },
  { key: "quoted", dataset: "quotations", metric: "quoted_value", href: "/sales-marketing/quotations" },
  { key: "enquiries", dataset: "enquiries", metric: "enquiry_count", href: "/sales-marketing/enquiries" },
  { key: "acceptance", dataset: "quotations", metric: "quotation_acceptance_rate", href: "/sales-marketing/quotations" },
  { key: "attributed", dataset: "campaigns", metric: "attributed_revenue", href: "/sales-marketing/attribution" },
  { key: "roi", dataset: "campaigns", metric: "campaign_roi", href: "/sales-marketing/attribution" },
];

/** Time grain for the trend: days for a month, weeks up to a quarter, months beyond. */
export function trendGrain(from: string, to: string): "day" | "week" | "month" {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return days <= 45 ? "day" : days <= 120 ? "week" : "month";
}

async function tile(actor: SalesActor, q: ReportQueryInput): Promise<Tile> {
  try {
    const r = await runGovernedQuery(actor, q);
    if (!r.columns.some((c) => c.kind === "metric")) return { status: "HIDDEN", message: r.unavailableMetrics.map((u) => u.reason).join(" ") || "You don't have access." };
    return { status: "OK", result: r };
  } catch (e) {
    if (e instanceof BusinessRuleError && e.code === "PERMISSION_DENIED") return { status: "HIDDEN", message: e.message };
    return { status: "ERROR", message: e instanceof BusinessRuleError ? e.message : "Couldn't load this." };
  }
}

const countSafe = async (fn: () => Promise<number>) => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

async function workQueue(actor: SalesActor): Promise<QueueItem[]> {
  const can = (m: string, a: string) => PermissionService.can(actor.userId, m as never, a as never);
  const [enq, quoView, quoApprove, campView, campApprove, promoApprove, attrApprove, wfView, intApprove] = await Promise.all([
    can("sales_marketing", "view"),
    can("sales_quotations", "view"),
    can("sales_quotations", "approve"),
    can("marketing_campaigns", "view"),
    can("marketing_campaigns", "approve"),
    can("marketing_promotions", "approve"),
    can("marketing_attribution", "approve"),
    can("sales_workflows", "view"),
    can("sales_integrations", "approve"),
  ]);
  const today = new Date(`${indiaToday()}T00:00:00Z`);
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const items: (QueueItem & { count: number | null })[] = [];
  const add = (i: Omit<QueueItem, "count">, count: number | null) => items.push({ ...i, count: count ?? 0 });

  if (enq) {
    const scope = await getSalesEnquiryScope(actor);
    const open = { salesStage: { in: OPEN_STAGE_KEYS }, status: { not: "CANCELLED" as const } };
    add({ key: "overdue_followups", label: "Overdue enquiry follow-ups", tone: "red", href: "/sales-marketing/enquiries", hint: "Open enquiries whose next follow-up date has passed (tick “Overdue” on the list)." }, await countSafe(() => prisma.buyerEnquiry.count({ where: enquiryScopedWhere(actor, scope, { ...open, nextFollowUpDate: { lt: today } }) })));
    add({ key: "awaiting_qualification", label: "Enquiries to qualify", tone: "amber", href: "/sales-marketing/enquiries", hint: "Open enquiries still at New or Under review." }, await countSafe(() => prisma.buyerEnquiry.count({ where: enquiryScopedWhere(actor, scope, { ...open, salesStage: { in: ["NEW", "UNDER_REVIEW"] } }) })));
  }
  if (quoView) {
    const scope = await getQuotationScope(actor);
    if (quoApprove) add({ key: "quotes_to_approve", label: "Quotations waiting for approval", tone: "amber", href: "/sales-marketing/quotations", hint: "You can approve; authors can't approve their own." }, await countSafe(() => prisma.quotation.count({ where: quotationScopedWhere(actor, scope, { status: "PENDING_APPROVAL" }) })));
    add({ key: "quotes_expiring", label: "Issued quotations expiring in 7 days", tone: "amber", href: "/sales-marketing/quotations", hint: "Awaiting the customer's decision; valid-until within a week." }, await countSafe(() => prisma.quotation.count({ where: quotationScopedWhere(actor, scope, { status: "ISSUED", revisions: { some: { issuedAt: { not: null }, validUntil: { gte: today, lte: in7 }, status: "ISSUED" } } }) })));
    add({ key: "quotes_to_convert", label: "Accepted quotations not yet ordered", tone: "indigo", href: "/sales-marketing/quotations", hint: "Convert them to Sales Orders." }, await countSafe(() => prisma.quotation.count({ where: quotationScopedWhere(actor, scope, { status: "ACCEPTED" }) })));
  }
  if (campView) {
    const scope = await getCampaignScope(actor);
    if (campApprove) add({ key: "campaigns_to_approve", label: "Campaigns waiting for approval", tone: "amber", href: "/sales-marketing/campaigns", hint: "Submitted campaigns." }, await countSafe(() => prisma.marketingCampaign.count({ where: { AND: [campaignScopeWhere(actor, scope), { status: "PENDING_APPROVAL" }] } })));
    add({ key: "budget_alerts", label: "Open campaign budget alerts", tone: "red", href: "/sales-marketing/budgets", hint: "Over budget, over-allocated or near the threshold." }, await countSafe(() => prisma.marketingBudgetAlert.count({ where: { companyId: actor.companyId, status: "OPEN", campaign: campaignScopeWhere(actor, scope) } })));
  }
  if (promoApprove) add({ key: "promotions_to_approve", label: "Promotion versions waiting for approval", tone: "amber", href: "/sales-marketing/promotions", hint: "Approved by someone other than the author." }, await countSafe(() => prisma.marketingPromotionVersion.count({ where: { companyId: actor.companyId, status: "PENDING_APPROVAL" } })));
  if (attrApprove) add({ key: "attribution_to_approve", label: "Attribution model versions waiting for approval", tone: "amber", href: "/sales-marketing/attribution/models", hint: "New rules take effect after approval and a recalculation." }, await countSafe(() => prisma.marketingAttributionModelVersion.count({ where: { companyId: actor.companyId, status: "PENDING_APPROVAL" } })));
  if (wfView) add({ key: "workflow_problems", label: "Workflows needing attention", tone: "red", href: "/sales-marketing/workflows", hint: "Failed or waiting for a person to retry, resolve or cancel." }, await countSafe(() => prisma.smWorkflowInstance.count({ where: { companyId: actor.companyId, status: { in: ["NEEDS_ATTENTION", "FAILED"] } } })));
  if (intApprove) add({ key: "sync_conflicts", label: "Open integration sync conflicts", tone: "amber", href: "/sales-marketing/integrations?tab=conflicts", hint: "External updates that clashed with ERP changes." }, await countSafe(() => prisma.integrationConflict.count({ where: { companyId: actor.companyId, status: "OPEN" } })));
  return items;
}

async function systemHealth(actor: SalesActor, period: { from: string; to: string }): Promise<HealthItem[]> {
  const can = (m: string, a: string) => PermissionService.can(actor.userId, m as never, a as never);
  const [attr, delivery, intView, admin, analytics] = await Promise.all([can("marketing_attribution", "view"), can("marketing_delivery", "view"), can("sales_integrations", "view"), can("sales_marketing_settings", "edit"), can("sales_analytics", "view")]);
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const since24 = new Date(Date.now() - 86_400_000);
  const out: HealthItem[] = [];
  if (attr) {
    const f: Freshness = (await datasetFreshness(actor, DATASETS.campaigns, period, null))[0];
    out.push({ key: "attribution", label: "Attribution calculation", status: f.status === "CURRENT" ? "OK" : f.status === "FAILED" ? "FAIL" : f.status === "UNKNOWN" ? "UNKNOWN" : "WARN", detail: `${f.label} — ${f.detail}`, href: "/sales-marketing/attribution" });
  }
  if (delivery) {
    const failed = await prisma.marketingDeliveryRun.count({ where: { companyId: actor.companyId, status: { in: ["FAILED", "PARTIALLY_COMPLETED"] }, updatedAt: { gte: since7 } } });
    out.push({ key: "delivery", label: "Campaign message runs (7 days)", status: failed ? "WARN" : "OK", detail: failed ? `${failed} run(s) failed or partly failed.` : "No failed runs.", href: "/sales-marketing/delivery" });
  }
  if (intView) {
    const [bad, hooks] = await Promise.all([
      prisma.integration.count({ where: { companyId: actor.companyId, status: { in: ["FAILED", "DEGRADED"] } } }),
      prisma.crmWebhookDelivery.count({ where: { companyId: actor.companyId, eventSource: "INTEGRATION", status: "FAILED", createdAt: { gte: since24 } } }),
    ]);
    out.push({ key: "integrations", label: "Integrations", status: bad ? "FAIL" : "OK", detail: bad ? `${bad} integration(s) failed or degraded.` : "All connected integrations healthy.", href: "/sales-marketing/integrations" });
    out.push({ key: "webhooks", label: "Outgoing S&M webhooks (24 h)", status: hooks ? "WARN" : "OK", detail: hooks ? `${hooks} delivery(ies) failed after retries.` : "No failed deliveries.", href: "/sales-marketing/integrations?tab=webhooks" });
  }
  // Bulk jobs: admins see every S&M job, others their own (same rule as the Bulk Jobs page).
  const bulkFailed = await prisma.bulkJob.count({ where: { companyId: actor.companyId, entityType: { in: [...SM_BULK_ENTITIES] }, status: { in: ["FAILED", "COMPLETED_WITH_ERRORS"] }, finishedAt: { gte: since7 }, dryRun: false, ...(admin ? {} : { requestedByUserId: actor.userId }) } });
  out.push({ key: "bulk", label: admin ? "Bulk jobs (7 days)" : "Your bulk jobs (7 days)", status: bulkFailed ? "WARN" : "OK", detail: bulkFailed ? `${bulkFailed} job(s) failed or finished with errors.` : "No failed jobs.", href: "/sales-marketing/bulk-jobs" });
  if (analytics) {
    const [failed, skipped] = await Promise.all([
      prisma.smAnalyticsDelivery.count({ where: { companyId: actor.companyId, report: { ownerUserId: actor.userId }, status: "FAILED", createdAt: { gte: since7 } } }),
      prisma.smAnalyticsDelivery.count({ where: { companyId: actor.companyId, report: { ownerUserId: actor.userId }, status: "SKIPPED", createdAt: { gte: since7 } } }),
    ]);
    out.push({ key: "report_deliveries", label: "Your report deliveries (7 days)", status: failed ? "FAIL" : skipped ? "WARN" : "OK", detail: failed || skipped ? `${failed} failed, ${skipped} skipped (recipient without access).` : "All delivered.", href: "/sales-marketing/analytics?tab=deliveries" });
  }
  return out;
}

export async function getSalesMarketingHome(actor: SalesActor, raw: unknown) {
  const { preset } = homeQuerySchema.parse(raw ?? {});
  const c = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
  const period = resolvePreset(preset, indiaToday(), c?.fiscalYearStartMonth ?? 4);
  const base = { ...period, compare: "previous_period" as const };

  const kpiResults = await Promise.all(KPIS.map((k) => tile(actor, { ...base, dataset: k.dataset, metrics: [k.metric] })));
  const kpis: (KpiTile | (Omit<KpiTile, "value" | "previous" | "change"> & { hidden: string }))[] = KPIS.map((k, i) => {
    const m = METRIC_BY_ID.get(k.metric)!;
    const query: ReportQueryInput = { ...base, dataset: k.dataset, metrics: [k.metric], groupBy: k.dataset === "campaigns" ? ["campaign"] : ["period"], timeGrain: trendGrain(period.from, period.to) };
    const common = { key: k.key, metricId: k.metric, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter, description: m.description, href: k.href, query };
    const t = kpiResults[i];
    if (t.status !== "OK") return { ...common, hidden: t.message };
    return { ...common, value: t.result.totals.values[k.metric] ?? null, previous: t.result.totals.compare?.[k.metric] ?? null, change: t.result.totals.change?.[k.metric] ?? null };
  });

  const [trend, funnel, byRep, byChannel, byCustomer, targets, queue, health] = await Promise.all([
    tile(actor, { ...period, dataset: "orders", metrics: ["booked_order_value", "booked_order_count"], groupBy: ["period"], timeGrain: trendGrain(period.from, period.to) }),
    tile(actor, { ...period, dataset: "funnel", metrics: ["funnel_received", "funnel_qualified", "funnel_quoted", "funnel_accepted", "funnel_ordered", "funnel_invoiced"] }),
    tile(actor, { ...period, dataset: "orders", metrics: ["booked_order_value", "booked_order_count"], groupBy: ["rep"], limit: 5, sort: { by: "booked_order_value", dir: "desc" } }),
    tile(actor, { ...period, dataset: "orders", metrics: ["booked_order_value"], groupBy: ["channel"], limit: 5, sort: { by: "booked_order_value", dir: "desc" } }),
    tile(actor, { ...period, dataset: "orders", metrics: ["booked_order_value"], groupBy: ["customer"], limit: 5, sort: { by: "booked_order_value", dir: "desc" } }),
    tile(actor, { ...period, dataset: "targets", metrics: ["target_value", "target_actual", "target_attainment"], groupBy: ["target"], limit: 8, sort: { by: "target_attainment", dir: "asc" } }),
    workQueue(actor),
    systemHealth(actor, period),
  ]);

  return {
    preset,
    presetLabel: PERIOD_PRESETS[preset],
    period,
    generatedAt: new Date().toISOString(),
    kpis,
    trend,
    funnel,
    team: { byRep, byChannel, byCustomer, targets },
    queue,
    health,
    canOpenAnalytics: await PermissionService.can(actor.userId, "sales_analytics", "view"),
  };
}
export type SalesMarketingHome = Awaited<ReturnType<typeof getSalesMarketingHome>>;

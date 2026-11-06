import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { round2 } from "@/lib/money";
import { campaignScopeWhere, getCampaignScope } from "@/modules/sales-marketing/campaigns/campaign-common";
import { CAMPAIGN_STATUSES, METRIC_UNITS, type CampaignStatusKey, type MetricUnitKey } from "@/modules/sales-marketing/campaigns/campaign-registry";
import { measureCampaigns, metricView } from "@/modules/sales-marketing/campaigns/campaign-results.service";
import { dbDate, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { measureBudgets } from "@/modules/sales-marketing/budgets/budget.service";
import { registerReport, type ReportViewer } from "./registry";

/**
 * Marketing campaign reports (Sales & Marketing Phase 08, 2026-11-04), in the
 * Sales & Marketing Report Center category. Same visibility as the Campaigns
 * screens; figures from the same services (linked-record counts, linked
 * Expenses) — not attribution or ROI.
 */

const CATEGORY = "sales-marketing" as const;
const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

async function campaignsFor(companyId: string, filters: Record<string, string>, viewer: ReportViewer) {
  await PermissionService.assert(viewer.userId, "marketing_campaigns", "view");
  const actor = { companyId, userId: viewer.userId, branchId: null };
  const scope = await getCampaignScope(actor);
  const from = iso(filters.dateFrom);
  const to = iso(filters.dateTo);
  const status = (Object.keys(CAMPAIGN_STATUSES) as CampaignStatusKey[]).includes(filters.status as CampaignStatusKey) ? (filters.status as CampaignStatusKey) : null;
  return prisma.marketingCampaign.findMany({
    where: {
      AND: [campaignScopeWhere(actor, scope), status ? { status } : {}, from ? { plannedEndDate: { gte: toDbDate(from) } } : {}, to ? { plannedStartDate: { lte: toDbDate(to) } } : {}],
    },
    orderBy: [{ plannedStartDate: "desc" }, { code: "asc" }],
    take: 2000,
    include: { type: { select: { name: true } }, objective: { select: { name: true } }, owner: { select: { fullName: true } }, department: { select: { name: true } }, metrics: { orderBy: { sortOrder: "asc" }, include: { manualUpdatedBy: { select: { fullName: true } } } } },
  });
}

function applied(filters: Record<string, string>) {
  return [
    ...(iso(filters.dateFrom) ? [{ label: "Planned from", value: filters.dateFrom }] : []),
    ...(iso(filters.dateTo) ? [{ label: "Planned to", value: filters.dateTo }] : []),
    ...(filters.status ? [{ label: "Status", value: CAMPAIGN_STATUSES[filters.status as CampaignStatusKey]?.label ?? filters.status }] : []),
  ];
}

async function getCampaignRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const campaigns = await campaignsFor(companyId, filters, viewer);
  const budgets = await measureBudgets(companyId, campaigns);
  const rows = campaigns.map((c) => {
    const b = budgets.get(c.id)!;
    const actual = b.actual;
    const planned = c.plannedBudget === null ? null : round2(Number(c.plannedBudget));
    return {
      campaignId: c.id,
      code: c.code,
      name: c.name,
      type: c.type.name,
      objective: c.objective.name,
      owner: c.owner.fullName,
      department: c.department?.name ?? "—",
      status: CAMPAIGN_STATUSES[c.status as CampaignStatusKey].label,
      plannedStart: dbDate(c.plannedStartDate),
      plannedEnd: dbDate(c.plannedEndDate),
      actualStart: c.actualStartDate ? dbDate(c.actualStartDate) : null,
      actualEnd: c.actualEndDate ? dbDate(c.actualEndDate) : null,
      plannedBudget: planned,
      actualSpend: actual,
      committed: b.committed,
      remaining: planned === null ? null : round2(planned - actual - b.committed),
    };
  });
  return {
    title: "Campaign Register",
    subtitle: "Campaigns with their status, planned and actual dates, planned budget (approved planning figure) and actual spend (approved / partly paid / paid Expenses plus posted Purchase Invoices linked to the campaign, before GST), committed (approved Purchase Orders not yet invoiced) and remaining = planned − actual − committed. Company currency.",
    filtersApplied: applied(filters),
    columns: [
      { key: "code", label: "Campaign", linkTo: "campaign" },
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "objective", label: "Objective" },
      { key: "owner", label: "Owner" },
      { key: "department", label: "Department" },
      { key: "status", label: "Status" },
      { key: "plannedStart", label: "Planned start", type: "date" },
      { key: "plannedEnd", label: "Planned end", type: "date" },
      { key: "actualStart", label: "Actual start", type: "date" },
      { key: "actualEnd", label: "Actual end", type: "date" },
      { key: "plannedBudget", label: "Planned budget", type: "currency", align: "right" },
      { key: "actualSpend", label: "Actual spend", type: "currency", align: "right" },
      { key: "committed", label: "Committed", type: "currency", align: "right" },
      { key: "remaining", label: "Remaining", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      code: `${rows.length} campaigns`,
      plannedBudget: round2(rows.reduce((s, r) => s + (r.plannedBudget ?? 0), 0)),
      actualSpend: round2(rows.reduce((s, r) => s + r.actualSpend, 0)),
      committed: round2(rows.reduce((s, r) => s + r.committed, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getCampaignResultsDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const campaigns = await campaignsFor(companyId, filters, viewer);
  const measured = await measureCampaigns(companyId, campaigns.map((c) => c.id));
  const rows = campaigns.flatMap((c) =>
    c.metrics.map((m) => {
      const v = metricView(m, measured.get(c.id));
      return {
        campaignId: c.id,
        code: c.code,
        name: c.name,
        status: CAMPAIGN_STATUSES[c.status as CampaignStatusKey].label,
        metric: v.label,
        unit: METRIC_UNITS[v.unit as MetricUnitKey] ?? v.unit,
        target: v.target,
        actual: v.actual,
        percentOfTarget: v.percentOfTarget,
        source: v.source === "SYSTEM" ? "Measured" : "Manual",
        provenance: v.provenance,
      };
    })
  );
  return {
    title: "Campaign Results",
    subtitle: "Target vs actual for each campaign success metric. Measured metrics count leads, enquiries, accepted quotations, booked orders and invoices that carry the campaign (Phase 05 rules), up to today; manual ones are entered by hand. Not attribution or ROI.",
    filtersApplied: applied(filters),
    columns: [
      { key: "code", label: "Campaign", linkTo: "campaign" },
      { key: "name", label: "Name" },
      { key: "status", label: "Status" },
      { key: "metric", label: "Metric" },
      { key: "unit", label: "Unit" },
      { key: "target", label: "Target", type: "number", align: "right" },
      { key: "actual", label: "Actual", type: "number", align: "right" },
      { key: "percentOfTarget", label: "% of target", type: "number", align: "right" },
      { key: "source", label: "Source" },
      { key: "provenance", label: "How it is counted" },
    ],
    rows,
    totals: { code: `${rows.length} metrics` },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "campaign-register", title: "Campaign Register", buildDescriptor: getCampaignRegisterDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "campaign-results", title: "Campaign Results", buildDescriptor: getCampaignResultsDescriptor, pdfOrientation: "landscape" });

export { getCampaignRegisterDescriptor, getCampaignResultsDescriptor };

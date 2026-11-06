import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { attributionReport } from "@/modules/sales-marketing/attribution/attribution-report.service";
import { REVENUE_BASES, REVENUE_BASIS_KEYS, type RevenueBasis } from "@/modules/sales-marketing/attribution/attribution-registry";
import { registerReport, type ReportViewer } from "./registry";

/**
 * Attribution reports (Sales & Marketing Phase 13) in the Sales & Marketing
 * Report Center category. Same numbers as the Attribution & ROI screen (the
 * same service), from the newest completed run of each model. Attribution
 * shares credit by a rule; it doesn't prove a campaign caused a sale.
 */

const CATEGORY = "sales-marketing" as const;
const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const basisOf = (v: string | undefined): RevenueBasis => (REVENUE_BASIS_KEYS.includes(v as RevenueBasis) ? (v as RevenueBasis) : "ORDER_VALUE");
const ratio = (r: { value: number | null }) => r.value;

async function getAttributionRoiDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const basis = basisOf(filters.basis);
  const actor = { companyId, userId: viewer.userId, branchId: null };
  const r = await attributionReport(actor, { basis, from: iso(filters.dateFrom), to: iso(filters.dateTo) });
  const rows = r.rows.map((x) => ({
    campaignId: x.campaignId,
    code: x.code,
    name: x.name,
    messagesDelivered: x.messagesDelivered,
    campaignResponses: x.campaignResponses,
    leads: x.credited.LEAD_CREATED,
    enquiries: x.credited.ENQUIRY_CREATED,
    quotations: x.credited.QUOTATION_ACCEPTED,
    orders: x.credited.SALES_ORDER_BOOKED,
    revenue: x.revenue,
    actualSpend: x.actualSpend,
    costPerOrder: x.costPerOrder,
    roi: ratio(x.roi),
    roas: ratio(x.roas),
  }));
  return {
    title: "Campaign Attribution & ROI",
    subtitle: r.model
      ? `Model ${r.model.code} v${r.model.version ?? "?"} · run ${r.run ? `${r.run.from} – ${r.run.to}` : "none yet"} · revenue = ${REVENUE_BASES[basis].label} (before GST) · spend = actual (approved expenses + posted purchase invoices) dated in the period. ROI is revenue-based, not profit; blank when there is no spend. Credit shows how the model shares conversions, not that a campaign caused them.`
      : "No attribution model is in use yet.",
    filtersApplied: [
      { label: "Revenue basis", value: REVENUE_BASES[basis].label },
      ...(r.period ? [{ label: "Period", value: `${r.period.from} – ${r.period.to}` }] : []),
    ],
    columns: [
      { key: "code", label: "Campaign", linkTo: "campaign" },
      { key: "name", label: "Name" },
      { key: "messagesDelivered", label: "Messages delivered", type: "number", align: "right" },
      { key: "campaignResponses", label: "Records tagged", type: "number", align: "right" },
      { key: "leads", label: "Leads (credit)", type: "number", align: "right" },
      { key: "enquiries", label: "Enquiries (credit)", type: "number", align: "right" },
      { key: "quotations", label: "Accepted quotes (credit)", type: "number", align: "right" },
      { key: "orders", label: "Orders (credit)", type: "number", align: "right" },
      { key: "revenue", label: "Attributed revenue", type: "currency", align: "right" },
      { key: "actualSpend", label: "Actual spend", type: "currency", align: "right" },
      { key: "costPerOrder", label: "Cost per order", type: "currency", align: "right" },
      { key: "roi", label: "ROI % (revenue-based)", type: "number", align: "right" },
      { key: "roas", label: "ROAS", type: "number", align: "right" },
    ],
    rows,
    totals: r.totals ? { code: `${rows.length} campaigns`, revenue: r.totals.revenue, actualSpend: r.totals.actualSpend, roi: ratio(r.totals.roi), roas: ratio(r.totals.roas) } : undefined,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
    ...(r.model && r.run ? {} : { unavailableReason: r.quality.notices.join(" ") }),
  } as ReportDescriptor;
}

async function getModelComparisonDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const basis = basisOf(filters.basis);
  const actor = { companyId, userId: viewer.userId, branchId: null };
  const models = await prisma.marketingAttributionModel.findMany({ where: { companyId, status: "ACTIVE" }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], take: 6, select: { id: true, code: true } });
  const byCampaign = new Map<string, Record<string, unknown>>();
  for (const m of models) {
    const r = await attributionReport(actor, { modelId: m.id, basis, from: iso(filters.dateFrom), to: iso(filters.dateTo) });
    for (const x of r.rows) {
      const row = byCampaign.get(x.campaignId) ?? { campaignId: x.campaignId, code: x.code, name: x.name };
      row[`credit_${m.code}`] = REVENUE_BASES[basis].conversion === "QUOTATION_ACCEPTED" ? x.credited.QUOTATION_ACCEPTED : x.credited.SALES_ORDER_BOOKED;
      row[`revenue_${m.code}`] = x.revenue;
      byCampaign.set(x.campaignId, row);
    }
  }
  const rows = [...byCampaign.values()];
  return {
    title: "Attribution Model Comparison",
    subtitle: `The same conversions under each model in use (its newest completed run), revenue = ${REVENUE_BASES[basis].label} before GST. Different models share credit differently; none is "the true" one.`,
    filtersApplied: [{ label: "Revenue basis", value: REVENUE_BASES[basis].label }],
    columns: [
      { key: "code", label: "Campaign", linkTo: "campaign" },
      { key: "name", label: "Name" },
      ...models.flatMap((m) => [
        { key: `credit_${m.code}`, label: `${m.code}: credit`, type: "number" as const, align: "right" as const },
        { key: `revenue_${m.code}`, label: `${m.code}: revenue`, type: "currency" as const, align: "right" as const },
      ]),
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
    ...(models.length ? {} : { unavailableReason: "No attribution model is in use yet." }),
  } as ReportDescriptor;
}

registerReport({ category: CATEGORY, key: "campaign-attribution-roi", title: "Campaign Attribution & ROI", buildDescriptor: getAttributionRoiDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "attribution-model-comparison", title: "Attribution Model Comparison", buildDescriptor: getModelComparisonDescriptor, pdfOrientation: "landscape" });

export { getAttributionRoiDescriptor, getModelComparisonDescriptor };

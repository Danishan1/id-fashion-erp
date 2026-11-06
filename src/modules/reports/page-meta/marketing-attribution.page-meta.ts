import { REVENUE_BASES, REVENUE_BASIS_KEYS } from "@/modules/sales-marketing/attribution/attribution-registry";
import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sales-marketing";
const basis = { key: "basis", label: "Revenue basis", type: "select" as const, options: REVENUE_BASIS_KEYS.map((k) => ({ value: k, label: REVENUE_BASES[k].label })) };
const link = { campaign: (row: Record<string, unknown>) => (row.campaignId ? `/sales-marketing/attribution/campaigns/${row.campaignId}` : undefined) };

registerReportPageMeta({
  category: CATEGORY,
  key: "campaign-attribution-roi",
  title: "Campaign Attribution & ROI",
  description: "Credited conversions, attributed revenue, actual spend, cost per order, revenue-based ROI and ROAS per campaign under the default attribution model. Dates filter conversion dates (and spend dates).",
  filterFields: [basis],
  linkBuilders: link,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "attribution-model-comparison",
  title: "Attribution Model Comparison",
  description: "Credited orders (or accepted quotes) and attributed revenue per campaign under each attribution model in use, side by side.",
  filterFields: [basis],
  linkBuilders: link,
});

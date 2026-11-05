import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_KEYS } from "@/modules/sales-marketing/campaigns/campaign-registry";
import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sales-marketing";
const status = { key: "status", label: "Status", type: "select" as const, options: CAMPAIGN_STATUS_KEYS.map((k) => ({ value: k, label: CAMPAIGN_STATUSES[k].label })) };
const link = { campaign: (row: Record<string, unknown>) => (row.campaignId ? `/sales-marketing/campaigns/${row.campaignId}` : undefined) };

registerReportPageMeta({
  category: CATEGORY,
  key: "campaign-register",
  title: "Campaign Register",
  description: "Campaigns with status, planned and actual dates, planned budget and actual spend from linked expenses. Date filters match the planned dates.",
  filterFields: [status],
  linkBuilders: link,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "campaign-results",
  title: "Campaign Results",
  description: "Target vs actual for every campaign success metric, with whether it is measured from ERP records or entered by hand.",
  filterFields: [status],
  linkBuilders: link,
});

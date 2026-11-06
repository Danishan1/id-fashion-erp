import { registerReportPageMeta } from "../report-page-meta";
import { SALES_TARGET_METRICS, SALES_TARGET_SCOPES } from "@/modules/sales-marketing/performance/performance-registry";

const CATEGORY = "sales-marketing";

const linkBuilders = {
  target: (row: Record<string, unknown>) => (row.targetId ? `/sales-marketing/targets/${row.targetId}` : undefined),
  salesOrder: (row: Record<string, unknown>) => (row.salesOrderId ? `/sales-orders/${row.salesOrderId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "target-attainment",
  title: "Target Attainment",
  description: "Sales targets you can see, by period start: approved target, live actual, gap, attainment and pace.",
  filterFields: [
    { key: "metric", label: "Metric", type: "select", options: SALES_TARGET_METRICS.map((m) => ({ value: m.key, label: m.label })) },
    { key: "scope", label: "Scope", type: "select", options: SALES_TARGET_SCOPES.map((s) => ({ value: s.key, label: s.label })) },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "approved", label: "Approved" },
        { value: "pending", label: "Waiting for approval" },
        { value: "draft", label: "Draft only" },
        { value: "archived", label: "Archived" },
        { value: "all", label: "All" },
      ],
    },
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "sales-credit-register",
  title: "Sales Credit Register",
  description: "Booked Sales Orders by order date with the sales rep and territory each is credited to, pieces and value before GST.",
  filterFields: [
    { key: "salesRepUserId", label: "Sales rep", type: "select", optionsUrl: "/api/v1/sales-marketing/performance/reps", optionsLabelKey: "fullName" },
    { key: "salesTerritoryId", label: "Territory", type: "select", optionsUrl: "/api/v1/sales-marketing/performance/territories/options" },
  ],
  linkBuilders,
});

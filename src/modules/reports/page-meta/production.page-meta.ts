import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "production";

const linkBuilders = {
  productionOrder: (row: Record<string, unknown>) => (row.productionOrderId ? `/production-orders/${row.productionOrderId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "production-register",
  title: "Production Register",
  description: "Every Job Order matching the selected filters, with drill-down to its Production Order.",
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "order-wise-production",
  title: "Order-wise Production",
  description: "Job Order quantities aggregated per Production Order.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "production-pending",
  title: "Production Pending",
  description: "Job Orders still carrying unaccounted-for planned quantity.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "production-achievement",
  title: "Production Achievement %",
  description: "Per Production Order: completed quantity as a percentage of planned quantity, worst performers first.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "production-rejection",
  title: "Production Rejection %",
  description: "Per Production Order: rejected quantity as a percentage of total produced quantity, worst performers first.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "line-wise-production",
  title: "Line-wise Production",
  description: "Job Order quantities aggregated by Production Line.",
  includeDateRange: false,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "operator-wise-production",
  title: "Operator-wise Production",
  description: "Job Order progress entries aggregated by the Employee who performed the work.",
  includeDateRange: false,
});

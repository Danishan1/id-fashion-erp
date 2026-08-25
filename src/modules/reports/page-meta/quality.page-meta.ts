import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "quality";

const linkBuilders = {
  productionOrder: (row: Record<string, unknown>) => (row.productionOrderId ? `/production-orders/${row.productionOrderId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "qc-inspection-register",
  title: "QC Inspection Register",
  description: "Every QC Inspection matching the selected filters, with drill-down to its Production Order.",
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "defect-wise-analysis",
  title: "Defect-wise Analysis",
  description: "QC defect quantities aggregated by defect type.",
  linkBuilders,
});

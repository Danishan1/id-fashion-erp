import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "material-consumption";

registerReportPageMeta({
  category: CATEGORY,
  key: "material-consumption-variance",
  title: "Material Consumption Variance",
  description: "BOM-computed requirement vs. actual issued quantity, per Production Order.",
  includeDateRange: false,
  linkBuilders: { productionOrder: (row) => (row.productionOrderId ? `/production-orders/${row.productionOrderId}` : undefined) },
});

registerReportPageMeta({
  category: CATEGORY,
  key: "consumption-by-material-category",
  title: "Consumption by Material Category",
  description: "Actual material issued, grouped by material category.",
});

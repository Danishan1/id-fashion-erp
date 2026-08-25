import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "production-planning";

registerReportPageMeta({
  category: CATEGORY,
  key: "production-schedule",
  title: "Production Schedule",
  description: "Planned vs. actual start/end dates per Production Order.",
  includeDateRange: false,
  filterFields: [
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["PLANNED", "MATERIAL_ALLOCATED", "IN_PROGRESS", "ON_HOLD", "CANCELLED", "CLOSED"].map((s) => ({ value: s, label: s })),
    },
  ],
  linkBuilders: { productionOrder: (row) => (row.productionOrderId ? `/production-orders/${row.productionOrderId}` : undefined) },
});

registerReportPageMeta({
  category: CATEGORY,
  key: "delayed-production-orders",
  title: "Delayed Production Orders",
  description: "Open Production Orders past their planned end date with no actual completion recorded yet.",
  includeDateRange: false,
  linkBuilders: { productionOrder: (row) => (row.productionOrderId ? `/production-orders/${row.productionOrderId}` : undefined) },
});

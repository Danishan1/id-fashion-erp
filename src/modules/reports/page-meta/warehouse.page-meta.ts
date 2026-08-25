import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "warehouse";

registerReportPageMeta({
  category: CATEGORY,
  key: "warehouse-stock-summary",
  title: "Warehouse Stock Summary",
  description: "Per-warehouse stock rollup — SKU count, total quantity, stock value, low-stock item count.",
  includeDateRange: false,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "warehouse-register",
  title: "Warehouse Register",
  description: "All warehouses matching the selected filters, with their configured location count.",
  includeDateRange: false,
  filterFields: [
    {
      key: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
  ],
});

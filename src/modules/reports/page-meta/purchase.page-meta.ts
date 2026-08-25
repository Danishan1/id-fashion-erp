import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "purchase";

const linkBuilders = {
  purchaseOrder: (row: Record<string, unknown>) => (row.purchaseOrderId ? `/purchase-orders/${row.purchaseOrderId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "purchase-order-register",
  title: "Purchase Order Register",
  description: "Every Purchase Order matching the selected filters, with drill-down to each order.",
  filterFields: [{ key: "supplierId", label: "Supplier", type: "select", optionsUrl: "/api/v1/suppliers?pageSize=200" }],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "pending-purchase-order",
  title: "Pending Purchase Order",
  description: "Purchase Order lines not yet fully received.",
  includeDateRange: false,
  filterFields: [{ key: "supplierId", label: "Supplier", type: "select", optionsUrl: "/api/v1/suppliers?pageSize=200" }],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "supplier-wise-purchase",
  title: "Supplier-wise Purchase",
  description: "Purchase Order totals grouped by supplier (excludes cancelled orders).",
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "purchase-monthly-summary",
  title: "Purchase Monthly Summary",
  description: "Non-cancelled Purchase Orders grouped by calendar month.",
  linkBuilders,
});

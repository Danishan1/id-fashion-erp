import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "profitability";

registerReportPageMeta({
  category: CATEGORY,
  key: "order-profitability",
  title: "Order Profitability",
  description: "Revenue vs. tracked material cost per Sales Order. Labour and Overhead are not tracked in this ERP.",
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
  linkBuilders: { salesOrder: (row) => (row.salesOrderId ? `/sales-orders/${row.salesOrderId}` : undefined) },
});

registerReportPageMeta({
  category: CATEGORY,
  key: "style-profitability",
  title: "Style Profitability",
  description: "Revenue vs. tracked material cost per Style. Labour and Overhead are not tracked in this ERP.",
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
  linkBuilders: { product: (row) => (row.productId ? `/masters/products/${row.productId}` : undefined) },
});

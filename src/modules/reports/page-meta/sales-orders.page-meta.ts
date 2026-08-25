import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sales-orders";

const linkBuilders = {
  salesOrder: (row: Record<string, unknown>) => (row.salesOrderId ? `/sales-orders/${row.salesOrderId}` : undefined),
  salesInvoice: (row: Record<string, unknown>) => (row.salesInvoiceId ? `/accounts/sales-invoices/${row.salesInvoiceId}` : undefined),
  customer: () => undefined,
};

registerReportPageMeta({
  category: CATEGORY,
  key: "order-register",
  title: "Order Register",
  description: "Every Sales Order matching the selected filters, with drill-down to each order.",
  filterFields: [
    { key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "DISPATCHED", "INVOICED", "CLOSED", "ON_HOLD", "CANCELLED"].map((s) => ({
        value: s,
        label: s,
      })),
    },
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "sales-register",
  title: "Sales Register",
  description: "Posted Sales Invoices — reconciles exactly with each invoice's own detail page.",
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "customer-wise-sales",
  title: "Customer-wise Sales",
  description: "Posted Sales Invoice totals grouped by customer.",
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "pending-orders",
  title: "Pending Orders",
  description: "Sales Orders not yet fully dispatched, invoiced, closed, or cancelled.",
  includeDateRange: false,
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "order-aging",
  title: "Order Aging",
  description: "Pending orders bucketed by age since order date.",
  includeDateRange: false,
  linkBuilders,
});

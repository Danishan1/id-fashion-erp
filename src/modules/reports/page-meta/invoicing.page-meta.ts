import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "invoicing";

const linkBuilders = {
  salesInvoice: (row: Record<string, unknown>) => (row.salesInvoiceId ? `/accounts/sales-invoices/${row.salesInvoiceId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "sales-invoice-register",
  title: "Sales Invoice Register",
  description: "Every Sales Invoice matching the selected filters.",
  filterFields: [
    { key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "CLOSED", "CANCELLED"].map((s) => ({ value: s, label: s })),
    },
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "outstanding-invoice",
  title: "Outstanding Invoice",
  description: "Sales Invoices with a real unpaid balance.",
  includeDateRange: false,
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
  linkBuilders,
});

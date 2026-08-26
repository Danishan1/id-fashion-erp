import { registerReportPageMeta } from "../report-page-meta";

registerReportPageMeta({
  category: "receivables",
  key: "customer-outstanding",
  title: "Customer Outstanding / AR Aging",
  description: "Per-invoice AR aging.",
  includeDateRange: false,
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
  linkBuilders: { salesInvoice: (row) => (row.salesInvoiceId ? `/accounts/sales-invoices/${row.salesInvoiceId}` : undefined) },
});

registerReportPageMeta({
  category: "receivables",
  key: "customer-ledger",
  title: "Customer Ledger",
  description: "Running-balance account statement for one customer.",
  filterFields: [{ key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" }],
});

registerReportPageMeta({
  category: "payables",
  key: "supplier-outstanding",
  title: "Supplier Outstanding / AP Aging",
  description: "Per-invoice AP aging.",
  includeDateRange: false,
  filterFields: [{ key: "supplierId", label: "Supplier", type: "select", optionsUrl: "/api/v1/suppliers?pageSize=200" }],
  linkBuilders: { purchaseInvoice: (row) => (row.purchaseInvoiceId ? `/accounts/purchase-invoices/${row.purchaseInvoiceId}` : undefined) },
});

registerReportPageMeta({
  category: "payables",
  key: "payment-made-register",
  title: "Payment Made Register",
  description: "Payments made to suppliers.",
  filterFields: [{ key: "supplierId", label: "Supplier", type: "select", optionsUrl: "/api/v1/suppliers?pageSize=200" }],
  linkBuilders: { payment: (row) => (row.paymentId ? `/accounts/payments/${row.paymentId}` : undefined) },
});

registerReportPageMeta({
  category: "expenses",
  key: "expense-register",
  title: "Expense Register",
  description: "Every non-cancelled Expense matching the selected filters.",
  linkBuilders: { expense: (row) => (row.expenseId ? `/accounts/expenses/${row.expenseId}` : undefined) },
});

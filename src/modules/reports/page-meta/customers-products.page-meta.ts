import { registerReportPageMeta } from "../report-page-meta";

const statusOptions = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

registerReportPageMeta({
  category: "customers",
  key: "customer-register",
  title: "Customer Register",
  description: "All customers matching the selected filters.",
  includeDateRange: false,
  filterFields: [{ key: "status", label: "Status", type: "select", options: statusOptions }],
  linkBuilders: { customer: (row) => (row.customerId ? `/masters/customers/${row.customerId}` : undefined) },
});

registerReportPageMeta({
  category: "customers",
  key: "customer-outstanding",
  title: "Customer Outstanding",
  description: "Per-customer AR summary from posted/partially-paid Sales Invoices.",
  includeDateRange: false,
  linkBuilders: { customer: () => undefined },
});

registerReportPageMeta({
  category: "products",
  key: "style-register",
  title: "Style Register",
  description: "All styles matching the selected filters.",
  includeDateRange: false,
  filterFields: [
    { key: "categoryId", label: "Category", type: "select", optionsUrl: "/api/v1/categories?pageSize=200" },
    { key: "seasonId", label: "Season", type: "select", optionsUrl: "/api/v1/seasons?pageSize=200" },
    { key: "status", label: "Status", type: "select", options: statusOptions },
  ],
  linkBuilders: { product: (row) => (row.productId ? `/masters/products/${row.productId}` : undefined) },
});

registerReportPageMeta({
  category: "products",
  key: "style-wise-production",
  title: "Style-wise Production",
  description: "Job Order quantities aggregated by style.",
  includeDateRange: false,
});

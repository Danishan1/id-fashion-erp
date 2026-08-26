import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "suppliers";

const linkBuilders = {
  supplier: (row: Record<string, unknown>) => (row.supplierId ? `/masters/suppliers/${row.supplierId}` : undefined),
  purchaseInvoice: (row: Record<string, unknown>) => (row.purchaseInvoiceId ? `/accounts/purchase-invoices/${row.purchaseInvoiceId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "supplier-register",
  title: "Supplier Register",
  description: "All suppliers matching the selected filters.",
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
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "supplier-outstanding",
  title: "Supplier Outstanding",
  description: "AP aging from posted/partially-paid Purchase Invoices.",
  includeDateRange: false,
  filterFields: [{ key: "supplierId", label: "Supplier", type: "select", optionsUrl: "/api/v1/suppliers?pageSize=200" }],
  linkBuilders,
});

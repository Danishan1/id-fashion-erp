import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sampling";
const RAW_MATERIAL_CATEGORY = "sampling-raw-material";

const linkBuilders = {
  sampleRequest: (row: Record<string, unknown>) => (row.sampleRequestId ? `/sampling/${row.sampleRequestId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "sample-register",
  title: "Sample Register",
  description: "Every Sample Request matching the selected filters, with drill-down to each request.",
  filterFields: [
    { key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: [
        "DRAFT",
        "REQUESTED",
        "TECH_PACK_READY",
        "IN_DEVELOPMENT",
        "INTERNAL_QC",
        "SUBMITTED_TO_CUSTOMER",
        "CUSTOMER_FEEDBACK_RECEIVED",
        "REVISION_REQUESTED",
        "APPROVED",
        "REJECTED",
        "ON_HOLD",
        "CANCELLED",
      ].map((s) => ({ value: s, label: s })),
    },
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "sample-status-report",
  title: "Sample Status Report",
  description: "All Sample Requests grouped by current status.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "sample-conversion-report",
  title: "Sample Conversion Report",
  description: "Per customer: how many raised samples were actually converted into a real Style master.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: RAW_MATERIAL_CATEGORY,
  key: "sample-material-requirement",
  title: "Sample Material Requirement",
  description: "Planned and damaged raw-material quantities per Sample Request, across all versions.",
  linkBuilders,
});

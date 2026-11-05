import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sales-marketing";

registerReportPageMeta({
  category: CATEGORY,
  key: "sales-by-channel",
  title: "Sales by Channel",
  description: "Booked orders, accepted quotations and invoiced value per sales channel (the document's own channel), with the share that has no channel.",
  filterFields: [],
});

registerReportPageMeta({
  category: CATEGORY,
  key: "commission-register",
  title: "Commission Register",
  description: "Commission statement lines — per invoice or collection, reversals, incentives, carry-forwards and adjustments — with statement and payment status.",
  filterFields: [
    { key: "month", label: "Month (YYYY-MM)", type: "text" },
    {
      key: "status",
      label: "Statement status",
      type: "select",
      options: [
        { value: "DRAFT", label: "Draft" },
        { value: "PENDING_APPROVAL", label: "Waiting for approval" },
        { value: "APPROVED", label: "Approved" },
      ],
    },
  ],
  linkBuilders: { statement: (row: Record<string, unknown>) => (row.statementId ? `/sales-marketing/commissions/statements/${row.statementId}` : undefined) },
});

import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "accounts";

const linkBuilders = {
  chartOfAccount: () => undefined,
  journal: (row: Record<string, unknown>) => (row.journalId ? `/accounts/journals/${row.journalId}` : undefined),
};

registerReportPageMeta({
  category: CATEGORY,
  key: "trial-balance",
  title: "Trial Balance",
  description: "Per-account debit/credit totals across every posted journal.",
  includeDateRange: false,
  filterFields: [{ key: "asOfDate", label: "As Of Date", type: "date" }],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "general-ledger",
  title: "General Ledger",
  description: "Every posted journal line for one account, with a running balance.",
  filterFields: [{ key: "accountId", label: "Account", type: "select", optionsUrl: "/api/v1/chart-of-accounts?pageSize=200" }],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "day-book",
  title: "Day Book",
  description: "Every posted journal line, in date order, across all accounts.",
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "journal-register",
  title: "Journal Register",
  description: "Every Journal matching the selected filters, one row per journal.",
  filterFields: [
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["DRAFT", "POSTED", "CANCELLED"].map((s) => ({ value: s, label: s })),
    },
  ],
  linkBuilders,
});

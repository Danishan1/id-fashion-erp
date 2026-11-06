import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "sales-marketing";
const periodType = {
  key: "periodType",
  label: "Period type",
  type: "select" as const,
  options: [
    { value: "MONTH", label: "Month" },
    { value: "QUARTER", label: "Quarter" },
    { value: "YEAR", label: "Year" },
  ],
};

registerReportPageMeta({
  category: CATEGORY,
  key: "forecast-pipeline",
  title: "Forecast Pipeline",
  description: "Open quotations and CRM opportunities behind the current forecast, with probability and weighted value; optionally the ones left out and why.",
  filterFields: [
    periodType,
    {
      key: "show",
      label: "Show",
      type: "select",
      options: [
        { value: "all", label: "All open items and left out" },
        { value: "excluded", label: "Left out only" },
      ],
    },
  ],
  linkBuilders: {
    record: (row: Record<string, unknown>) => (row.recordId ? (row.source === "QUOTATION" ? `/sales-marketing/quotations/${row.recordId}` : `/crm/opportunities/${row.recordId}`) : undefined),
  },
});

registerReportPageMeta({
  category: CATEGORY,
  key: "forecast-accuracy",
  title: "Forecast Accuracy",
  description: "How close the start-of-period forecasts came to what was actually booked, per ended period, with MAE, WAPE and bias.",
  filterFields: [periodType],
  linkBuilders: { snapshot: (row: Record<string, unknown>) => (row.snapshotId ? `/sales-marketing/forecast/snapshots/${row.snapshotId}` : undefined) },
});

import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "inventory";

const linkBuilders = {
  product: (row: Record<string, unknown>) => (row.productId ? `/masters/materials/${row.productId}` : undefined),
};

const warehouseFilterField = {
  key: "warehouseId",
  label: "Warehouse",
  type: "select" as const,
  optionsUrl: "/api/v1/warehouses?pageSize=200",
};

registerReportPageMeta({
  category: CATEGORY,
  key: "stock-summary",
  title: "Stock Summary",
  description: "Current stock on hand across all warehouses.",
  includeDateRange: false,
  filterFields: [warehouseFilterField],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "stock-ledger",
  title: "Stock Ledger",
  description: "Every inventory transaction matching the selected filters, most recent first.",
  filterFields: [warehouseFilterField],
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "low-stock-report",
  title: "Low Stock Report",
  description: "Stock balances below their Product master's configured Reorder Level.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "negative-stock-report",
  title: "Negative Stock Report",
  description: "Stock balances that have gone negative — a data-integrity check.",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: CATEGORY,
  key: "stock-valuation",
  title: "Stock Valuation",
  description: "Stock on hand valued at each Product master's Unit Cost.",
  includeDateRange: false,
  linkBuilders,
});

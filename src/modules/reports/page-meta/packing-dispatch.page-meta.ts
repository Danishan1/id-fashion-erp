import { registerReportPageMeta } from "../report-page-meta";

const linkBuilders = {
  dispatch: (row: Record<string, unknown>) => (row.dispatchId ? `/dispatch/${row.dispatchId}` : undefined),
};

// ===========================================================================
// Category: packing
// ===========================================================================
const PACKING_CATEGORY = "packing";

registerReportPageMeta({
  category: PACKING_CATEGORY,
  key: "carton-summary",
  title: "Carton Summary",
  description: "Every Carton packed, with drill-down to its parent dispatch.",
  linkBuilders,
});

registerReportPageMeta({
  category: PACKING_CATEGORY,
  key: "color-size-packing",
  title: "Color-wise / Size-wise Packing",
  description: "Packing composition by color/size, as actually packed — not a sales or revenue figure.",
});

// ===========================================================================
// Category: dispatch
// ===========================================================================
const DISPATCH_CATEGORY = "dispatch";

registerReportPageMeta({
  category: DISPATCH_CATEGORY,
  key: "dispatch-register",
  title: "Dispatch Register",
  description: "Every Dispatch matching the selected filters, with drill-down to each dispatch.",
  filterFields: [
    { key: "customerId", label: "Customer", type: "select", optionsUrl: "/api/v1/customers?pageSize=200" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["DRAFT", "PACKED", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED"].map((s) => ({ value: s, label: s })),
    },
  ],
  linkBuilders,
});

registerReportPageMeta({
  category: DISPATCH_CATEGORY,
  key: "pending-dispatch",
  title: "Pending Dispatch",
  description: "Dispatches not yet actually shipped (Draft, Packed, or On Hold).",
  includeDateRange: false,
  linkBuilders,
});

registerReportPageMeta({
  category: DISPATCH_CATEGORY,
  key: "customer-wise-dispatch",
  title: "Customer-wise Dispatch",
  description: "Dispatch count and total dispatched quantity grouped by customer, excluding cancelled dispatches.",
});

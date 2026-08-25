import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "business-performance";

registerReportPageMeta({
  category: CATEGORY,
  key: "top-customers-by-revenue",
  title: "Top Customers by Revenue",
  description: "Top 20 customers by posted Sales Invoice revenue.",
});

registerReportPageMeta({
  category: CATEGORY,
  key: "top-styles-by-revenue",
  title: "Top Styles by Revenue",
  description: "Top 20 styles by posted Sales Invoice line revenue.",
});

registerReportPageMeta({
  category: CATEGORY,
  key: "monthly-sales-trend",
  title: "Monthly Sales Trend",
  description: "Posted Sales Invoice revenue by calendar month, across all history.",
  includeDateRange: false,
});

import type { PeriodPreset } from "./analytics-periods";
import type { ReportQueryInput } from "./analytics-registry";

/**
 * Phase 17 — standard dashboards (client-safe definitions). Each widget is a
 * governed report query without a period; the dashboard's period (a relative
 * preset) is applied when it runs. Widgets run with the viewer's own
 * permissions: a widget the viewer can't see is shown as "not available to
 * you" with the reason, never as zero. The same metric ids as everywhere, so
 * a dashboard number always matches the report builder.
 */

export type WidgetKind = "kpi" | "line" | "bar" | "table" | "funnel";
export interface DashboardWidget {
  id: string;
  title: string;
  kind: WidgetKind;
  /** 1 = quarter width, 2 = half, 4 = full. */
  span: 1 | 2 | 4;
  query: Omit<ReportQueryInput, "from" | "to">;
}
export interface DashboardDef {
  key: string;
  label: string;
  description: string;
  defaultPreset: PeriodPreset;
  widgets: DashboardWidget[];
}

const kpi = (id: string, title: string, dataset: string, metric: string, compare: "previous_period" | "previous_year" = "previous_period"): DashboardWidget => ({ id, title, kind: "kpi", span: 1, query: { dataset, metrics: [metric], groupBy: [], compare } });

export const DASHBOARDS: DashboardDef[] = [
  {
    key: "executive",
    label: "Executive",
    description: "Bookings, billing, cash and pipeline at a glance, compared with the previous period.",
    defaultPreset: "this_fiscal_year",
    widgets: [
      kpi("ex-booked", "Booked order value", "orders", "booked_order_value"),
      kpi("ex-invoiced", "Invoiced value (before GST)", "invoices", "invoiced_value"),
      kpi("ex-cash", "Cash collected", "payments", "cash_collected"),
      kpi("ex-quoted", "Quoted value", "quotations", "quoted_value"),
      { id: "ex-trend", title: "Bookings by month", kind: "line", span: 4, query: { dataset: "orders", metrics: ["booked_order_value", "booked_order_count"], groupBy: ["period"], timeGrain: "month" } },
      { id: "ex-funnel", title: "Enquiry funnel", kind: "funnel", span: 2, query: { dataset: "funnel", metrics: ["funnel_received", "funnel_qualified", "funnel_quoted", "funnel_accepted", "funnel_ordered", "funnel_invoiced"], groupBy: [] } },
      { id: "ex-customers", title: "Top customers by bookings", kind: "bar", span: 2, query: { dataset: "orders", metrics: ["booked_order_value"], groupBy: ["customer"], limit: 10, sort: { by: "booked_order_value", dir: "desc" } } },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    description: "Enquiries, quotations and orders by rep and channel; targets.",
    defaultPreset: "this_quarter",
    widgets: [
      kpi("sa-enq", "Enquiries received", "enquiries", "enquiry_count"),
      kpi("sa-quote-rate", "Enquiries quoted", "enquiries", "enquiry_quotation_rate"),
      kpi("sa-accept", "Quotation acceptance", "quotations", "quotation_acceptance_rate"),
      kpi("sa-aov", "Average order value", "orders", "avg_order_value"),
      { id: "sa-rep", title: "Bookings by sales rep", kind: "bar", span: 2, query: { dataset: "orders", metrics: ["booked_order_value", "booked_order_count"], groupBy: ["rep"], limit: 15, sort: { by: "booked_order_value", dir: "desc" } } },
      { id: "sa-channel", title: "Bookings by channel", kind: "bar", span: 2, query: { dataset: "orders", metrics: ["booked_order_value"], groupBy: ["channel"], limit: 15, sort: { by: "booked_order_value", dir: "desc" } } },
      { id: "sa-stage", title: "Enquiries by stage", kind: "table", span: 2, query: { dataset: "enquiries", metrics: ["enquiry_count"], groupBy: ["stage"] } },
      { id: "sa-targets", title: "Targets in the period", kind: "table", span: 2, query: { dataset: "targets", metrics: ["target_value", "target_actual", "target_attainment"], groupBy: ["target"], limit: 20 } },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Attributed revenue, spend and return by campaign (Phase 13 attribution, Phase 12 spend).",
    defaultPreset: "this_quarter",
    widgets: [
      kpi("mk-rev", "Attributed revenue", "campaigns", "attributed_revenue"),
      kpi("mk-spend", "Actual marketing spend", "campaigns", "marketing_spend"),
      kpi("mk-roi", "Revenue-based ROI", "campaigns", "campaign_roi"),
      kpi("mk-cpo", "Cost per credited order", "campaigns", "cost_per_order"),
      { id: "mk-campaigns", title: "Campaigns", kind: "table", span: 4, query: { dataset: "campaigns", metrics: ["attributed_revenue", "marketing_spend", "campaign_roi", "campaign_roas", "credited_orders", "messages_delivered"], groupBy: ["campaign"], limit: 25, sort: { by: "attributed_revenue", dir: "desc" } } },
      { id: "mk-source", title: "Enquiries by source", kind: "bar", span: 2, query: { dataset: "enquiries", metrics: ["enquiry_count"], groupBy: ["source"] } },
      { id: "mk-direct", title: "Bookings directly linked to a campaign", kind: "bar", span: 2, query: { dataset: "orders", metrics: ["booked_order_value"], groupBy: ["campaign"], limit: 10, sort: { by: "booked_order_value", dir: "desc" } } },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    description: "Workflows, bulk jobs and outgoing webhooks — is the machinery healthy?",
    defaultPreset: "last_30_days",
    widgets: [
      kpi("op-wf", "Workflows started", "workflows", "workflow_count"),
      kpi("op-wf-problem", "Workflows with a problem", "workflows", "workflow_problem"),
      kpi("op-bulk", "Bulk item success rate", "bulk", "bulk_item_success_rate"),
      kpi("op-hook", "Webhook failure rate", "webhooks", "webhook_failure_rate"),
      { id: "op-wf-by", title: "Workflows by type", kind: "table", span: 2, query: { dataset: "workflows", metrics: ["workflow_count", "workflow_completed", "workflow_problem", "workflow_completion_hours"], groupBy: ["workflow"] } },
      { id: "op-bulk-by", title: "Bulk jobs by action", kind: "table", span: 2, query: { dataset: "bulk", metrics: ["bulk_job_count", "bulk_items_processed", "bulk_item_success_rate"], groupBy: ["action"] } },
      { id: "op-hook-trend", title: "Webhook deliveries by day", kind: "line", span: 4, query: { dataset: "webhooks", metrics: ["webhook_deliveries", "webhook_failure_rate"], groupBy: ["period"], timeGrain: "day" } },
    ],
  },
];

export const DASHBOARD_BY_KEY = new Map(DASHBOARDS.map((d) => [d.key, d]));

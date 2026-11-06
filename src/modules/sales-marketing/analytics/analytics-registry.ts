import { z } from "zod";

/**
 * Phase 17 — the governed analytics vocabulary. Client-safe (no Prisma).
 *
 * METRICS: one definition per KPI — id, version, formula, source, unit,
 * time field, permissions and limitations. A metric's meaning never changes
 * under the same id + version; a change of formula is a new version (saved
 * reports keep the version they were saved with and are refused, with a
 * clear message, if it is retired). Report authors can't edit formulas.
 *
 * DATASETS: each has one explicit grain (one row per …), the time fields it
 * can be grouped by, its dimensions and the permission that gates it. A
 * metric belongs to exactly one dataset, so a report never joins two grains
 * (no double counting); cross-grain questions (the funnel) are their own
 * dataset with per-entity EXISTS checks.
 */

export const ANALYTICS_TIMEZONE = "Asia/Kolkata";
export const REPORTING_CURRENCY_NOTE = "Company base currency (amounts frozen on each document at creation; no re-conversion at today's rates).";

export type Unit = "count" | "currency" | "percent" | "hours" | "ratio";
export type Perm = { module: string; action: string };

export interface DimensionDef {
  key: string;
  label: string;
  /** How labels are resolved for display. "enum" values are shown as-is with optional labels. */
  kind: "time" | "enum" | "user" | "channel" | "territory" | "customer" | "campaign" | "text";
  options?: Record<string, string>;
}

export interface DatasetDef {
  key: string;
  label: string;
  description: string;
  /** The grain — exactly one row of the dataset is … */
  grain: string;
  source: string;
  /** The module permission that gates the whole dataset (plus sales_analytics.view). */
  permission: Perm;
  timeFields: Record<string, { label: string; description: string }>;
  defaultTimeField: string;
  dimensions: DimensionDef[];
  /** SQL-backed datasets support arbitrary grouping; service-backed ones are per entity only. */
  engine: "sql" | "service";
  /** Freshness model. */
  freshness: "live" | "attribution" | "workflow-events";
  drillDown?: { label: string; hrefPrefix: string };
}

export interface MetricDef {
  id: string;
  version: number;
  label: string;
  dataset: string;
  description: string;
  purpose: string;
  formula: string;
  numerator?: string;
  denominator?: string;
  unit: Unit;
  /** sum / count: additive across every dimension and period; ratio / avg: never summed — recomputed from parts. */
  aggregation: "sum" | "count" | "ratio" | "avg";
  /** Extra permissions beyond the dataset's. */
  permissions?: Perm[];
  limitations: string[];
  /** Explicitly NOT the same as … (shown with the definition). */
  notToBeConfusedWith?: string[];
  /** Higher is better (for colouring changes). */
  higherIsBetter?: boolean;
  /** A retired metric is refused with a clear message; saved reports must switch to `replacedBy`. */
  retired?: boolean;
  replacedBy?: string;
}

const PERIOD: DimensionDef = { key: "period", label: "Period", kind: "time" };
const STAGES = { NEW: "New", UNDER_REVIEW: "Under review", QUALIFIED: "Qualified", QUOTATION_IN_PROGRESS: "Quotation in progress", QUOTED: "Quoted", WON: "Won", LOST: "Lost", NOT_QUALIFIED: "Not qualified", ON_HOLD: "On hold" };

export const DATASETS: Record<string, DatasetDef> = {
  enquiries: {
    key: "enquiries",
    label: "Enquiries",
    description: "Sales enquiries by the date they were received.",
    grain: "one row per enquiry",
    source: "buyer_enquiries (+ buyer_enquiry_activities for qualification history, quotations for quoting)",
    permission: { module: "sales_marketing", action: "view" },
    timeFields: { received: { label: "Enquiry date", description: "The enquiry's own business date." } },
    defaultTimeField: "received",
    dimensions: [
      PERIOD,
      { key: "stage", label: "Current stage", kind: "enum", options: STAGES },
      { key: "source", label: "Source", kind: "enum", options: { EMAIL: "Email", PHONE: "Phone", TRADE_SHOW: "Trade show", REFERRAL: "Referral", WEBSITE: "Website", OTHER: "Other" } },
      { key: "priority", label: "Priority", kind: "enum", options: { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" } },
      { key: "owner", label: "Owner", kind: "user" },
      { key: "channel", label: "Sales channel", kind: "channel" },
      { key: "party", label: "Customer or prospect", kind: "enum", options: { CUSTOMER: "Existing customer", PROSPECT: "Prospect" } },
    ],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Enquiry", hrefPrefix: "/sales-marketing/enquiries/" },
  },
  quotations: {
    key: "quotations",
    label: "Issued quotation revisions",
    description: "Every quotation revision that was issued to a customer, with the customer's decision on it.",
    grain: "one row per issued quotation revision (a revised quotation counts once per issued revision)",
    source: "quotation_revisions (issued_at set) joined to its quotation (n:1)",
    permission: { module: "sales_quotations", action: "view" },
    timeFields: {
      issued: { label: "Issue date", description: "When the revision was issued (India date)." },
      decided: { label: "Decision date", description: "When the customer's acceptance or rejection happened (India date); undecided revisions have none." },
    },
    defaultTimeField: "issued",
    dimensions: [
      PERIOD,
      { key: "decision", label: "Customer decision", kind: "enum", options: { ACCEPTED: "Accepted", REJECTED: "Rejected", OPEN: "No decision yet" } },
      { key: "owner", label: "Owner", kind: "user" },
      { key: "channel", label: "Sales channel", kind: "channel" },
      { key: "customer", label: "Customer", kind: "customer" },
    ],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Quotation", hrefPrefix: "/sales-marketing/quotations/" },
  },
  orders: {
    key: "orders",
    label: "Booked Sales Orders",
    description: "Booked Sales Orders by order date — the same rule as Phase 05 targets: Confirmed, In production, Partially dispatched, Dispatched, Invoiced or Closed (On hold only when held from one of those).",
    grain: "one row per Sales Order",
    source: "sales_orders (Phase 05 booked rule), base_total_amount",
    permission: { module: "sales_orders", action: "view" },
    timeFields: { ordered: { label: "Order date", description: "The order's business date." } },
    defaultTimeField: "ordered",
    dimensions: [
      PERIOD,
      { key: "rep", label: "Sales rep (credited)", kind: "user" },
      { key: "territory", label: "Territory", kind: "territory" },
      { key: "channel", label: "Sales channel", kind: "channel" },
      { key: "customer", label: "Customer", kind: "customer" },
      { key: "campaign", label: "Campaign set on the order (direct link, not attribution)", kind: "campaign" },
      { key: "origin", label: "Origin", kind: "enum", options: { QUOTATION: "From a quotation", DIRECT: "Direct" } },
      { key: "status", label: "Status", kind: "enum", options: { CONFIRMED: "Confirmed", IN_PRODUCTION: "In production", PARTIALLY_DISPATCHED: "Partly dispatched", DISPATCHED: "Dispatched", INVOICED: "Invoiced", CLOSED: "Closed", ON_HOLD: "On hold" } },
    ],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Sales Order", hrefPrefix: "/sales-orders/" },
  },
  invoices: {
    key: "invoices",
    label: "Sales invoices",
    description: "Posted sales invoices (not draft, not cancelled), by invoice date.",
    grain: "one row per sales invoice (an order with several invoices appears several times — never joined back to order value)",
    source: "sales_invoices (Phase 05 invoiced statuses: POSTED / PARTIALLY_PAID / PAID / CLOSED)",
    permission: { module: "accounts", action: "view" },
    timeFields: { invoiced: { label: "Invoice date", description: "The invoice's accounting date." } },
    defaultTimeField: "invoiced",
    dimensions: [
      PERIOD,
      { key: "customer", label: "Customer", kind: "customer" },
      { key: "rep", label: "Sales rep of the order", kind: "user" },
      { key: "status", label: "Payment status", kind: "enum", options: { POSTED: "Posted (unpaid)", PARTIALLY_PAID: "Partly paid", PAID: "Paid", CLOSED: "Closed" } },
    ],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Invoice", hrefPrefix: "/accounts/sales-invoices/" },
  },
  payments: {
    key: "payments",
    label: "Customer receipts",
    description: "Posted payments received from customers, by payment date.",
    grain: "one row per posted customer receipt",
    source: "payments (direction RECEIPT, status POSTED)",
    permission: { module: "accounts", action: "view" },
    timeFields: { received: { label: "Payment date", description: "The receipt's accounting date." } },
    defaultTimeField: "received",
    dimensions: [PERIOD, { key: "customer", label: "Customer", kind: "customer" }],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Payment", hrefPrefix: "/accounts/payments/" },
  },
  funnel: {
    key: "funnel",
    label: "Enquiry funnel (cohort)",
    description: "Enquiries received in the period, and how many of them have reached each later stage so far. Each enquiry counts at most once per stage.",
    grain: "one row per enquiry (the cohort); each later stage is looked up per enquiry (counted once), never joined",
    source: "buyer_enquiries → activities (qualified) → quotations / revisions (issued, accepted) → sales_orders (from that quotation) → sales_invoices → paid",
    permission: { module: "sales_marketing", action: "view" },
    timeFields: { received: { label: "Enquiry date", description: "The cohort is defined by the enquiry date; later stages may happen after the period." } },
    defaultTimeField: "received",
    dimensions: [PERIOD, { key: "owner", label: "Owner", kind: "user" }, { key: "channel", label: "Sales channel", kind: "channel" }, { key: "source", label: "Source", kind: "enum", options: { EMAIL: "Email", PHONE: "Phone", TRADE_SHOW: "Trade show", REFERRAL: "Referral", WEBSITE: "Website", OTHER: "Other" } }],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Enquiry", hrefPrefix: "/sales-marketing/enquiries/" },
  },
  campaigns: {
    key: "campaigns",
    label: "Campaign performance",
    description: "Per campaign: Phase 13 attributed results and Phase 12 actual spend for the period, plus the planned budget.",
    grain: "one row per campaign (credit is already split between campaigns by the approved attribution model, so rows add up without double counting)",
    source: "Phase 13 attribution report (marketing_attribution_credits of the current run) + Phase 12 actual spend + marketing_campaigns.planned_budget",
    permission: { module: "marketing_attribution", action: "view" },
    timeFields: { conversion: { label: "Conversion date", description: "The business date of each credited conversion; spend by its own date." } },
    defaultTimeField: "conversion",
    dimensions: [{ key: "campaign", label: "Campaign", kind: "campaign" }],
    engine: "service",
    freshness: "attribution",
    drillDown: { label: "Campaign attribution", hrefPrefix: "/sales-marketing/attribution/campaigns/" },
  },
  targets: {
    key: "targets",
    label: "Sales targets",
    description: "Approved targets whose period overlaps the range, with the actual from the Phase 05 credited results.",
    grain: "one row per target (its approved revision)",
    source: "sales_targets / sales_target_revisions + Phase 05 targetActual (credited Sales Orders)",
    permission: { module: "sales_performance", action: "view" },
    timeFields: { period: { label: "Target period", description: "Targets whose own period overlaps the range." } },
    defaultTimeField: "period",
    dimensions: [{ key: "target", label: "Target", kind: "text" }],
    engine: "service",
    freshness: "live",
    drillDown: { label: "Target", hrefPrefix: "/sales-marketing/targets/" },
  },
  workflows: {
    key: "workflows",
    label: "S&M workflows",
    description: "Phase 15 workflow runs by start date.",
    grain: "one row per workflow instance",
    source: "sm_workflow_instances (+ sm_workflow_step_runs for approval waits)",
    permission: { module: "sales_workflows", action: "view" },
    timeFields: { started: { label: "Start date", description: "When the workflow started (India date)." } },
    defaultTimeField: "started",
    dimensions: [
      PERIOD,
      { key: "workflow", label: "Workflow", kind: "enum", options: { quotation_follow_up: "Enquiry → approved quotation", quotation_to_order: "Quotation → Sales Order", campaign_readiness: "Campaign readiness", budget_exception: "Budget exception", processing_follow_up: "Processing follow-up" } },
      { key: "status", label: "Status", kind: "enum" },
    ],
    engine: "sql",
    freshness: "workflow-events",
    drillDown: { label: "Workflow", hrefPrefix: "/sales-marketing/workflows/instances/" },
  },
  bulk: {
    key: "bulk",
    label: "S&M bulk jobs",
    description: "Phase 14 background jobs on Sales & Marketing records (dry runs excluded), by creation date.",
    grain: "one row per bulk job (item counts are per job)",
    source: "bulk_jobs (S&M record types, dry_run = false)",
    permission: { module: "sales_marketing", action: "view" },
    timeFields: { created: { label: "Created", description: "When the job was requested (India date)." } },
    defaultTimeField: "created",
    dimensions: [PERIOD, { key: "recordType", label: "Record type", kind: "enum" }, { key: "action", label: "Action", kind: "enum" }, { key: "status", label: "Status", kind: "enum" }],
    engine: "sql",
    freshness: "live",
    drillDown: { label: "Bulk job", hrefPrefix: "/sales-marketing/bulk-jobs/" },
  },
  webhooks: {
    key: "webhooks",
    label: "Outgoing S&M webhooks",
    description: "Phase 16 deliveries of S&M events (test deliveries excluded), by creation date.",
    grain: "one row per delivery (one per subscription and event; retries are attempts of the same row)",
    source: "crm_webhook_deliveries (event_source INTEGRATION, is_test false)",
    permission: { module: "sales_integrations", action: "view" },
    timeFields: { created: { label: "Queued", description: "When the delivery was queued (India date)." } },
    defaultTimeField: "created",
    dimensions: [PERIOD, { key: "eventType", label: "Event type", kind: "text" }, { key: "status", label: "Status", kind: "enum" }],
    engine: "sql",
    freshness: "live",
  },
};

const BASE = "Company base currency";

export const METRICS: MetricDef[] = [
  // ── Enquiries ──
  { id: "enquiry_count", version: 1, label: "Enquiries received", dataset: "enquiries", unit: "count", aggregation: "count", higherIsBetter: true, description: "Enquiries whose enquiry date falls in the period.", purpose: "Demand coming in.", formula: "COUNT(enquiries)", limitations: ["Includes enquiries later cancelled in Merchandising."], notToBeConfusedWith: ["CRM leads (a separate CRM record)", "Qualified enquiries"] },
  { id: "qualified_enquiry_count", version: 1, label: "Qualified enquiries", dataset: "enquiries", unit: "count", aggregation: "count", higherIsBetter: true, description: "Enquiries of the period that have been moved to Qualified at least once (even if they later moved on or were lost).", purpose: "Demand worth pursuing.", formula: "COUNT(enquiries with a STAGE_CHANGED → QUALIFIED activity)", limitations: ["Enquiries that went straight to a quotation without being marked Qualified are not counted here."], notToBeConfusedWith: ["Enquiries received"] },
  { id: "enquiry_quotation_rate", version: 1, label: "Enquiry → quotation rate", dataset: "enquiries", unit: "percent", aggregation: "ratio", higherIsBetter: true, description: "Share of the period's enquiries that have at least one issued quotation (any revision, any date).", purpose: "How much demand turns into an offer.", formula: "quoted enquiries ÷ enquiries received", numerator: "Enquiries with ≥ 1 quotation that was issued", denominator: "Enquiries received", limitations: ["Recent enquiries may not have had time to be quoted."] },
  // ── Quotations ──
  { id: "quotation_issued_count", version: 1, label: "Quotation revisions issued", dataset: "quotations", unit: "count", aggregation: "count", higherIsBetter: true, description: "Quotation revisions issued in the period (a re-issued revision counts again).", purpose: "Offer activity.", formula: "COUNT(revisions with issued_at)", limitations: [] },
  { id: "quoted_value", version: 1, label: "Quoted value (before GST)", dataset: "quotations", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Taxable total (after discounts, before GST) of the revisions issued in the period.", purpose: "Value offered.", formula: "SUM(revision.taxable_total)", limitations: [BASE], notToBeConfusedWith: ["Accepted value", "Booked order value"] },
  { id: "quotation_accepted_count", version: 1, label: "Revisions accepted", dataset: "quotations", unit: "count", aggregation: "count", higherIsBetter: true, description: "Issued revisions the customer accepted.", purpose: "Won offers.", formula: "COUNT(revisions with status ACCEPTED)", limitations: ["Use the Decision date time field to count by when the customer decided."] },
  { id: "accepted_value", version: 1, label: "Accepted value (before GST)", dataset: "quotations", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Taxable total of the accepted revisions.", purpose: "Value won on paper, before an order exists.", formula: "SUM(taxable_total WHERE status = ACCEPTED)", limitations: [BASE], notToBeConfusedWith: ["Booked order value (an accepted quotation is not an order until converted)"] },
  { id: "quotation_rejected_count", version: 1, label: "Revisions rejected", dataset: "quotations", unit: "count", aggregation: "count", higherIsBetter: false, description: "Issued revisions the customer rejected.", purpose: "Lost offers.", formula: "COUNT(revisions with status REJECTED)", limitations: [] },
  { id: "quotation_acceptance_rate", version: 1, label: "Quotation acceptance rate", dataset: "quotations", unit: "percent", aggregation: "ratio", higherIsBetter: true, description: "Accepted ÷ decided (accepted + rejected) revisions. Undecided revisions are excluded, not counted as lost.", purpose: "Win rate on decided offers.", formula: "accepted ÷ (accepted + rejected)", numerator: "Accepted revisions", denominator: "Accepted + rejected revisions", limitations: ["With the Issue date time field, recent periods have few decisions yet."] },
  // ── Orders ──
  { id: "booked_order_count", version: 1, label: "Sales Orders booked", dataset: "orders", unit: "count", aggregation: "count", higherIsBetter: true, description: "Booked Sales Orders by order date (Phase 05 booked rule).", purpose: "Committed business.", formula: "COUNT(booked orders)", limitations: [] },
  { id: "booked_order_value", version: 1, label: "Booked order value", dataset: "orders", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Order value in the company base currency (frozen at creation), before GST, of booked orders — identical to the Phase 05 target metric.", purpose: "Committed revenue — not yet invoiced or collected.", formula: "SUM(sales_orders.base_total_amount)", limitations: [BASE, "An order cancelled later drops out of past periods."], notToBeConfusedWith: ["Invoiced value", "Cash collected", "Accepted quotation value"] },
  { id: "avg_order_value", version: 1, label: "Average order value", dataset: "orders", unit: "currency", aggregation: "avg", higherIsBetter: true, description: "Booked order value ÷ orders booked.", purpose: "Deal size.", formula: "SUM(base_total_amount) ÷ COUNT(orders)", numerator: "Booked order value", denominator: "Orders booked", limitations: [BASE] },
  // ── Invoices / cash ──
  { id: "invoice_count", version: 1, label: "Invoices posted", dataset: "invoices", unit: "count", aggregation: "count", description: "Posted sales invoices by invoice date.", purpose: "Billing activity.", formula: "COUNT(invoices)", limitations: [] },
  { id: "invoiced_value", version: 1, label: "Invoiced value (before tax)", dataset: "invoices", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Subtotal × the invoice's frozen exchange rate, of posted invoices, by invoice date.", purpose: "Billed revenue.", formula: "SUM(ROUND(subtotal_amount × exchange_rate, 2)) — identical to the Phase 05 INVOICED_VALUE target metric", limitations: [BASE, "Credit notes / refunds are not recorded in this ERP yet, so this is gross of returns.", "Not recognised revenue: the ERP has no revenue-recognition schedule."], notToBeConfusedWith: ["Booked order value", "Cash collected", "Recognised revenue (not available)"] },
  { id: "invoiced_value_incl_tax", version: 1, label: "Invoiced value (incl. tax)", dataset: "invoices", unit: "currency", aggregation: "sum", description: "Invoice base total including GST.", purpose: "Amount billed to customers.", formula: "SUM(base_total_amount)", limitations: [BASE] },
  { id: "cash_collected", version: 1, label: "Cash collected", dataset: "payments", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Posted customer receipts by payment date (company base currency).", purpose: "Money actually received.", formula: "SUM(payments.amount WHERE direction = RECEIPT AND status = POSTED)", limitations: ["Includes on-account receipts not yet allocated to an invoice."], notToBeConfusedWith: ["Invoiced value", "Booked order value"] },
  // ── Funnel ──
  { id: "funnel_received", version: 1, label: "Received", dataset: "funnel", unit: "count", aggregation: "count", description: "Enquiries in the cohort.", purpose: "Funnel start.", formula: "COUNT(enquiries)", limitations: [] },
  { id: "funnel_qualified", version: 1, label: "Qualified", dataset: "funnel", unit: "count", aggregation: "count", description: "Cohort enquiries ever marked Qualified.", purpose: "Funnel stage.", formula: "COUNT(enquiries EXISTS qualified activity)", limitations: ["Not every process marks Qualified before quoting — the funnel isn't assumed to be linear."] },
  { id: "funnel_quoted", version: 1, label: "Quotation issued", dataset: "funnel", unit: "count", aggregation: "count", description: "Cohort enquiries with ≥ 1 issued quotation revision.", purpose: "Funnel stage.", formula: "COUNT(enquiries EXISTS issued revision)", permissions: [{ module: "sales_quotations", action: "view" }], limitations: [] },
  { id: "funnel_accepted", version: 1, label: "Quotation accepted", dataset: "funnel", unit: "count", aggregation: "count", description: "Cohort enquiries with ≥ 1 accepted revision.", purpose: "Funnel stage.", formula: "COUNT(enquiries EXISTS accepted revision)", permissions: [{ module: "sales_quotations", action: "view" }], limitations: [] },
  { id: "funnel_ordered", version: 1, label: "Sales Order created", dataset: "funnel", unit: "count", aggregation: "count", description: "Cohort enquiries with a confirmed Sales Order converted from one of their quotations.", purpose: "Funnel stage.", formula: "COUNT(enquiries EXISTS non-draft, non-cancelled order with source revision of their quotation)", permissions: [{ module: "sales_orders", action: "view" }], limitations: ["Orders entered directly (not from the quotation) can't be linked to the enquiry."] },
  { id: "funnel_invoiced", version: 1, label: "Invoiced", dataset: "funnel", unit: "count", aggregation: "count", description: "Cohort enquiries whose order has ≥ 1 posted invoice.", purpose: "Funnel stage.", formula: "COUNT(enquiries EXISTS posted invoice of that order)", permissions: [{ module: "accounts", action: "view" }], limitations: [] },
  { id: "funnel_paid", version: 1, label: "Paid", dataset: "funnel", unit: "count", aggregation: "count", description: "Cohort enquiries whose order has an invoice marked Paid or Closed.", purpose: "Funnel end.", formula: "COUNT(enquiries EXISTS invoice status PAID / CLOSED)", permissions: [{ module: "accounts", action: "view" }], limitations: ["Partly paid invoices don't count as paid."] },
  // ── Campaigns (Phase 12 / 13) ──
  { id: "attributed_revenue", version: 1, label: "Attributed revenue", dataset: "campaigns", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Revenue credited to the campaign by the approved attribution model (Phase 13), on the model's revenue basis, before GST.", purpose: "Marketing's share of revenue, by the agreed rules.", formula: "SUM(credit weight × conversion value) for the campaign in the current run", limitations: ["Attribution, not proof of causation.", "Depends on the model and its last calculation (see freshness).", "Revenue, not profit."], notToBeConfusedWith: ["Booked order value", "Profit"] },
  { id: "marketing_spend", version: 1, label: "Actual marketing spend", dataset: "campaigns", unit: "currency", aggregation: "sum", higherIsBetter: false, description: "Phase 12 actual: approved expenses + posted purchase invoices linked to the campaign, dated in the period.", purpose: "What was spent.", formula: "SUM(approved expenses + posted purchase invoices linked to the campaign)", limitations: ["Committed (ordered, not invoiced) spend is excluded.", "Spend not linked to a campaign isn't counted."], notToBeConfusedWith: ["Planned budget", "Committed spend"] },
  { id: "planned_budget", version: 1, label: "Planned budget", dataset: "campaigns", unit: "currency", aggregation: "sum", description: "The campaign's approved planned budget (whole campaign, not pro-rated to the period).", purpose: "Budget reference.", formula: "SUM(marketing_campaigns.planned_budget)", limitations: ["Not pro-rated: compare with spend for the campaign's whole duration."] },
  { id: "budget_utilization", version: 1, label: "Budget utilisation", dataset: "campaigns", unit: "percent", aggregation: "ratio", description: "Actual spend ÷ planned budget.", purpose: "Spend against plan.", formula: "actual spend ÷ planned budget", numerator: "Actual marketing spend", denominator: "Planned budget", limitations: ["Meaningful when the period covers the whole campaign.", "n/a without a planned budget."] },
  { id: "campaign_roi", version: 1, label: "Revenue-based ROI", dataset: "campaigns", unit: "percent", aggregation: "ratio", higherIsBetter: true, description: "(Attributed revenue − actual spend) ÷ actual spend.", purpose: "Return on marketing spend.", formula: "(attributed revenue − spend) ÷ spend", numerator: "Attributed revenue − spend", denominator: "Actual spend", limitations: ["Revenue-based, not profit-based (no cost of goods).", "n/a when spend is zero."], notToBeConfusedWith: ["Profit-based ROI (not available)"] },
  { id: "campaign_roas", version: 1, label: "ROAS", dataset: "campaigns", unit: "ratio", aggregation: "ratio", higherIsBetter: true, description: "Attributed revenue ÷ actual spend.", purpose: "Revenue per rupee spent.", formula: "attributed revenue ÷ spend", numerator: "Attributed revenue", denominator: "Actual spend", limitations: ["n/a when spend is zero."] },
  { id: "credited_orders", version: 1, label: "Credited orders", dataset: "campaigns", unit: "count", aggregation: "sum", higherIsBetter: true, description: "Sales Orders credited to the campaign (fractional: credit is shared between campaigns).", purpose: "Conversions.", formula: "SUM(credit weight) for SALES_ORDER_BOOKED conversions", limitations: ["Fractional by design."] },
  { id: "cost_per_order", version: 1, label: "Cost per credited order", dataset: "campaigns", unit: "currency", aggregation: "ratio", higherIsBetter: false, description: "Actual spend ÷ credited orders.", purpose: "Acquisition cost.", formula: "spend ÷ credited orders", numerator: "Actual spend", denominator: "Credited orders", limitations: ["n/a without credited orders."] },
  { id: "messages_delivered", version: 1, label: "Messages delivered", dataset: "campaigns", unit: "count", aggregation: "sum", description: "Campaign messages reported delivered (Phase 10 touchpoints).", purpose: "Reach.", formula: "COUNT(MESSAGE_DELIVERED touchpoints)", limitations: ["Providers are not live-verified; SMTP has no delivery receipts."] },
  // ── Targets ──
  { id: "target_value", version: 1, label: "Target", dataset: "targets", unit: "currency", aggregation: "sum", description: "The approved target value.", purpose: "Goal.", formula: "approved revision target", limitations: ["Targets on a count metric are shown as counts."] },
  { id: "target_actual", version: 1, label: "Actual (credited)", dataset: "targets", unit: "currency", aggregation: "sum", higherIsBetter: true, description: "Phase 05 actual for the target's scope and its whole period.", purpose: "Result.", formula: "targetActual(target)", limitations: ["Uses the target's own period, not the report range."] },
  { id: "target_attainment", version: 1, label: "Attainment", dataset: "targets", unit: "percent", aggregation: "ratio", higherIsBetter: true, description: "Actual ÷ target.", purpose: "Progress to goal.", formula: "actual ÷ target", numerator: "Actual", denominator: "Target", limitations: [] },
  // ── Operations ──
  { id: "workflow_count", version: 1, label: "Workflows started", dataset: "workflows", unit: "count", aggregation: "count", description: "Workflow instances started in the period.", purpose: "Automation volume.", formula: "COUNT(instances)", limitations: [] },
  { id: "workflow_completed", version: 1, label: "Workflows completed", dataset: "workflows", unit: "count", aggregation: "count", higherIsBetter: true, description: "Instances now COMPLETED.", purpose: "Outcomes.", formula: "COUNT(status = COMPLETED)", limitations: [] },
  { id: "workflow_problem", version: 1, label: "Workflows failed / needing attention", dataset: "workflows", unit: "count", aggregation: "count", higherIsBetter: false, description: "Instances now FAILED or NEEDS_ATTENTION.", purpose: "Exceptions.", formula: "COUNT(status IN (FAILED, NEEDS_ATTENTION))", limitations: ["Current status, not history."] },
  { id: "workflow_completion_hours", version: 1, label: "Average time to complete", dataset: "workflows", unit: "hours", aggregation: "avg", higherIsBetter: false, description: "Average hours from start to completion, of completed instances.", purpose: "Cycle time.", formula: "AVG(completed_at − started_at) of COMPLETED", numerator: "Σ hours", denominator: "Completed instances", limitations: [] },
  { id: "approval_wait_hours", version: 1, label: "Average approval wait", dataset: "workflows", unit: "hours", aggregation: "avg", higherIsBetter: false, description: "Average hours instances spent in a finished 'follow the approval' step.", purpose: "Approval turnaround.", formula: "AVG(finished_at − started_at) of await_approval steps DONE", numerator: "Σ hours", denominator: "Approval steps", limitations: ["Only workflows with an approval step (quotation follow-up, campaign readiness)."] },
  { id: "bulk_job_count", version: 1, label: "Bulk jobs", dataset: "bulk", unit: "count", aggregation: "count", description: "S&M bulk jobs requested.", purpose: "Processing volume.", formula: "COUNT(jobs)", limitations: ["Without sales_marketing_settings.edit you see your own jobs only."] },
  { id: "bulk_items_processed", version: 1, label: "Records processed", dataset: "bulk", unit: "count", aggregation: "sum", description: "Records processed by the jobs.", purpose: "Throughput.", formula: "SUM(processed_count)", limitations: [] },
  { id: "bulk_item_success_rate", version: 1, label: "Record success rate", dataset: "bulk", unit: "percent", aggregation: "ratio", higherIsBetter: true, description: "Succeeded ÷ (succeeded + failed) records (skipped excluded).", purpose: "Processing quality.", formula: "SUM(succeeded) ÷ SUM(succeeded + failed)", numerator: "Succeeded records", denominator: "Succeeded + failed records", limitations: [] },
  { id: "webhook_deliveries", version: 1, label: "Webhook deliveries", dataset: "webhooks", unit: "count", aggregation: "count", description: "S&M webhook deliveries queued.", purpose: "Integration volume.", formula: "COUNT(deliveries)", limitations: [] },
  { id: "webhook_failure_rate", version: 1, label: "Webhook failure rate", dataset: "webhooks", unit: "percent", aggregation: "ratio", higherIsBetter: false, description: "Failed ÷ finished (delivered + failed) deliveries.", purpose: "Integration health.", formula: "failed ÷ (delivered + failed)", numerator: "Failed deliveries", denominator: "Delivered + failed", limitations: ["Pending and cancelled deliveries are excluded."] },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
export const metricsOf = (dataset: string) => METRICS.filter((m) => m.dataset === dataset && !m.retired);

export const ANALYTICS_LIMITS = {
  maxRangeDays: 731,
  maxMetrics: 6,
  maxGroupBy: 2,
  maxRows: 500,
  maxDrillRows: 200,
  /** An export holds the report's own rows (same cap as on screen) plus the totals. */
  maxExportRows: 500,
  statementTimeoutMs: 8000,
  slowQueryMs: 2000,
  runRetentionDays: 90,
  deliveryFileDays: 7,
} as const;

export const TIME_GRAINS = { day: "Day", week: "Week (Mon–Sun)", month: "Month", quarter: "Calendar quarter", year: "Calendar year", fiscal_quarter: "Fiscal quarter", fiscal_year: "Fiscal year" } as const;
export type TimeGrain = keyof typeof TIME_GRAINS;

export const FRESHNESS = {
  CURRENT: { label: "Current", tone: "green", help: "Read live from the source records at the time shown." },
  REFRESHING: { label: "Refreshing", tone: "indigo", help: "A recalculation is running; figures are from the previous one." },
  STALE: { label: "Stale", tone: "amber", help: "The calculation behind these figures is older than expected." },
  INCOMPLETE: { label: "Incomplete", tone: "amber", help: "Part of the requested range isn't covered by the calculation." },
  FAILED: { label: "Failed", tone: "red", help: "The last calculation failed; figures are from an earlier one or missing." },
  UNKNOWN: { label: "Unknown", tone: "zinc", help: "No calculation exists yet." },
} as const;
export type FreshnessStatus = keyof typeof FRESHNESS;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** The report definition a person (or a saved report) sends. Server-validated against the registry. */
export const reportQuerySchema = z
  .object({
    dataset: z.string().max(40),
    metrics: z.array(z.string().max(60)).min(1).max(ANALYTICS_LIMITS.maxMetrics),
    groupBy: z.array(z.string().max(40)).max(ANALYTICS_LIMITS.maxGroupBy).default([]),
    timeGrain: z.enum(Object.keys(TIME_GRAINS) as [TimeGrain, ...TimeGrain[]]).default("month"),
    timeField: z.string().max(40).optional(),
    from: isoDate,
    to: isoDate,
    filters: z.record(z.string().max(40), z.array(z.string().max(100)).max(50)).default({}),
    compare: z.enum(["none", "previous_period", "previous_year"]).default("none"),
    sort: z.object({ by: z.string().max(60), dir: z.enum(["asc", "desc"]) }).optional(),
    limit: z.coerce.number().int().min(1).max(ANALYTICS_LIMITS.maxRows).default(100),
  })
  .strict();
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportQueryInput = z.input<typeof reportQuerySchema>;

/** Period boundaries for comparisons (inclusive dates). */
export function comparePeriod(from: string, to: string, mode: "previous_period" | "previous_year") {
  const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (mode === "previous_year") {
    const shift = (s: string) => {
      const [y, m, dd] = s.split("-").map(Number);
      // 29 Feb → 28 Feb in a non-leap year.
      const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
      return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`;
    };
    return { from: shift(from), to: shift(to) };
  }
  const days = Math.round((d(to) - d(from)) / 86_400_000) + 1;
  return { from: iso(d(from) - days * 86_400_000), to: iso(d(from) - 86_400_000) };
}

/** A ratio with an empty denominator is "n/a", never 0. */
export function ratio(num: number, den: number, unit: Unit): number | null {
  if (!den) return null;
  const v = num / den;
  return unit === "percent" ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100;
}

export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

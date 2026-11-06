import { Prisma } from "@prisma/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { crmOwnerSql } from "@/modules/crm/core/crm-visibility";
import { crmScopeUserIds } from "@/modules/crm/core/crm-visibility";
import { getSalesEnquiryScope, type SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { bookedOrderSql } from "@/modules/sales-marketing/performance/performance-actuals";
import { INVOICED_STATUSES } from "@/modules/sales-marketing/performance/performance-registry";
import { getQuotationScope } from "@/modules/sales-marketing/quotations/quotation.service";

/**
 * Phase 17 — SQL datasets. Each returns ONE inner SELECT at the dataset's
 * grain, already restricted to the company, the requested date range on the
 * chosen time field, and the viewer's visibility in the source module (the
 * same rule as that module's list). Columns:
 *   id, ref, tf (the time-field date, India), upd (last change),
 *   d_<dimension> (text keys), p_<part> (numbers summed by the engine).
 * Every value is a bound parameter; nothing from a request is spliced in.
 * Cross-grain stages are EXISTS sub-queries, never joins, so a row is
 * counted once whatever it is linked to.
 */

export interface SqlCtx {
  actor: SalesActor;
  from: string;
  to: string;
  timeField: string;
}

export interface SqlDatasetImpl {
  key: string;
  /** null = the viewer can't see this dataset. */
  base: (ctx: SqlCtx) => Promise<Prisma.Sql | null>;
  /** Metric id → summed part columns (num [/ den]). */
  parts: Record<string, { num: string; den?: string }>;
  dimensions: string[];
  /** Columns shown when drilling into rows. */
  drill?: { valuePart?: string };
}

const IST = "Asia/Kolkata";
/** Business date (India) of a UTC timestamp column. */
const istDate = (col: string) => Prisma.raw(`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE '${IST}')::date`);
/** [from, to] business dates → UTC timestamp bounds [start, end). */
export function istBounds(from: string, to: string) {
  const start = new Date(Date.parse(`${from}T00:00:00+05:30`));
  const end = new Date(Date.parse(`${to}T00:00:00+05:30`) + 86_400_000);
  return { start, end };
}

async function branchSql(userId: string, col: string): Promise<Prisma.Sql> {
  const allowed = await PermissionService.getAllowedBranchIds(userId);
  if (allowed === null) return Prisma.empty;
  if (allowed.size === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${Prisma.raw(col)} IN (${Prisma.join([...allowed].map((id) => Prisma.sql`${id}::uuid`))})`;
}

/** Enquiry visibility: owner (or, unowned, the requester) in the viewer's team, unless view_all; plus branch. */
async function enquiryScopeSql(actor: SalesActor, alias: string) {
  const scope = await getSalesEnquiryScope(actor);
  let own = Prisma.empty;
  if (scope.record.mode !== "ALL") {
    const ids = Prisma.join(crmScopeUserIds(scope.record).map((id) => Prisma.sql`${id}::uuid`));
    own = Prisma.sql`AND (${Prisma.raw(`${alias}.owner_user_id`)} IN (${ids}) OR (${Prisma.raw(`${alias}.owner_user_id`)} IS NULL AND ${Prisma.raw(`${alias}.requested_by_user_id`)} IN (${ids})))`;
  }
  const b = scope.branch.branchId?.in;
  const branch = b ? (b.length ? Prisma.sql`AND ${Prisma.raw(`${alias}.branch_id`)} IN (${Prisma.join(b.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.sql`AND FALSE`) : Prisma.empty;
  return Prisma.sql`${own} ${branch}`;
}

const flag = (cond: Prisma.Sql) => Prisma.sql`CASE WHEN ${cond} THEN 1 ELSE 0 END`;

/**
 * Funnel stage flags per enquiry. Each stage is looked up per enquiry through
 * an index path (activities / quotations by enquiry → revisions → the order
 * made from a revision → that order's one active invoice), in LATERAL joins
 * that return at most one row, so an enquiry counts once per stage however
 * many quotations, orders or invoices it has. Plans were checked on 50,000
 * enquiries (Phase 17 performance test): a set-based GROUP BY variant was
 * mis-estimated into nested loops, and a status cast on invoices defeated the
 * partial index — both timed out.
 */
const enquiryStageJoins = (ctx: SqlCtx, withFunnel: boolean) => {
  const c = Prisma.sql`${ctx.actor.companyId}::uuid`;
  const qualified = Prisma.sql`LEFT JOIN LATERAL (
      SELECT 1 AS hit FROM buyer_enquiry_activities a
      WHERE a.buyer_enquiry_id = e.id AND a.type::text = 'STAGE_CHANGED' AND a.metadata->>'to' = 'QUALIFIED'
      LIMIT 1) fqual ON TRUE`;
  const quotes = Prisma.sql`LEFT JOIN LATERAL (
      SELECT MAX(CASE WHEN r.issued_at IS NOT NULL THEN 1 ELSE 0 END) AS quoted,
        MAX(CASE WHEN r.status::text = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted
      FROM quotations q JOIN quotation_revisions r ON r.quotation_id = q.id
      WHERE q.buyer_enquiry_id = e.id AND q.company_id = ${c}) fquo ON TRUE`;
  if (!withFunnel) return Prisma.sql`${qualified} ${quotes}`;
  const orders = Prisma.sql`LEFT JOIN LATERAL (
      SELECT 1 AS ordered,
        MAX(CASE WHEN si.status::text IN (${Prisma.join([...INVOICED_STATUSES])}) THEN 1 ELSE 0 END) AS invoiced,
        MAX(CASE WHEN si.status::text IN ('PAID', 'CLOSED') THEN 1 ELSE 0 END) AS paid
      FROM quotations q
      JOIN quotation_revisions r ON r.quotation_id = q.id
      JOIN sales_orders so ON so.source_quotation_revision_id = r.id
      LEFT JOIN sales_invoices si ON si.sales_order_id = so.id AND si.status <> 'CANCELLED'
      WHERE q.buyer_enquiry_id = e.id AND q.company_id = ${c} AND so.company_id = ${c} AND ${bookedOrderSql("so")}
      HAVING COUNT(so.id) > 0) ford ON TRUE`;
  return Prisma.sql`${qualified} ${quotes} ${orders}`;
};
const enquiryStageCols = (withFunnel: boolean) =>
  withFunnel
    ? Prisma.sql`COALESCE(fqual.hit, 0) AS p_qualified, COALESCE(fquo.quoted, 0) AS p_quoted, COALESCE(fquo.accepted, 0) AS p_accepted,
        COALESCE(ford.ordered, 0) AS p_ordered, COALESCE(ford.invoiced, 0) AS p_invoiced, COALESCE(ford.paid, 0) AS p_paid`
    : Prisma.sql`COALESCE(fqual.hit, 0) AS p_qualified, COALESCE(fquo.quoted, 0) AS p_quoted`;

const enquiriesBase = (withFunnel: boolean) => async (ctx: SqlCtx) => {
  if (!(await PermissionService.can(ctx.actor.userId, "sales_marketing", "view"))) return null;
  return Prisma.sql`
    SELECT e.id, e.enquiry_number AS ref, e.enquiry_date AS tf, e.updated_at AS upd,
      e.sales_stage::text AS d_stage, e.source::text AS d_source, e.priority::text AS d_priority,
      e.owner_user_id::text AS d_owner, e.sales_channel_id::text AS d_channel,
      CASE WHEN e.customer_id IS NULL THEN 'PROSPECT' ELSE 'CUSTOMER' END AS d_party,
      1 AS p_one, ${enquiryStageCols(withFunnel)}
    FROM buyer_enquiries e
    ${enquiryStageJoins(ctx, withFunnel)}
    WHERE e.company_id = ${ctx.actor.companyId}::uuid
      AND e.enquiry_date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
      ${await enquiryScopeSql(ctx.actor, "e")}`;
};

export const SQL_DATASETS: Record<string, SqlDatasetImpl> = {
  enquiries: {
    key: "enquiries",
    base: enquiriesBase(false),
    parts: { enquiry_count: { num: "one" }, qualified_enquiry_count: { num: "qualified" }, enquiry_quotation_rate: { num: "quoted", den: "one" } },
    dimensions: ["stage", "source", "priority", "owner", "channel", "party"],
  },
  funnel: {
    key: "funnel",
    base: enquiriesBase(true),
    parts: { funnel_received: { num: "one" }, funnel_qualified: { num: "qualified" }, funnel_quoted: { num: "quoted" }, funnel_accepted: { num: "accepted" }, funnel_ordered: { num: "ordered" }, funnel_invoiced: { num: "invoiced" }, funnel_paid: { num: "paid" } },
    dimensions: ["owner", "channel", "source"],
  },
  quotations: {
    key: "quotations",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "sales_quotations", "view"))) return null;
      const scope = await getQuotationScope(ctx.actor);
      const { start, end } = istBounds(ctx.from, ctx.to);
      const col = ctx.timeField === "decided" ? "r.customer_decision_at" : "r.issued_at";
      return Prisma.sql`
        SELECT q.id, q.quotation_number || ' / R' || r.revision_number AS ref, ${istDate(col)} AS tf, r.updated_at AS upd,
          CASE r.status::text WHEN 'ACCEPTED' THEN 'ACCEPTED' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'OPEN' END AS d_decision,
          q.owner_user_id::text AS d_owner, q.sales_channel_id::text AS d_channel, q.customer_id::text AS d_customer,
          1 AS p_one, r.taxable_total AS p_value,
          ${flag(Prisma.sql`r.status::text = 'ACCEPTED'`)} AS p_acc,
          CASE WHEN r.status::text = 'ACCEPTED' THEN r.taxable_total ELSE 0 END AS p_acc_value,
          ${flag(Prisma.sql`r.status::text = 'REJECTED'`)} AS p_rej,
          ${flag(Prisma.sql`r.status::text IN ('ACCEPTED', 'REJECTED')`)} AS p_decided
        FROM quotation_revisions r
        JOIN quotations q ON q.id = r.quotation_id
        WHERE q.company_id = ${ctx.actor.companyId}::uuid
          AND r.issued_at IS NOT NULL
          AND ${Prisma.raw(col)} >= ${start} AND ${Prisma.raw(col)} < ${end}
          ${crmOwnerSql(scope.record, "q")}`;
    },
    parts: {
      quotation_issued_count: { num: "one" },
      quoted_value: { num: "value" },
      quotation_accepted_count: { num: "acc" },
      accepted_value: { num: "acc_value" },
      quotation_rejected_count: { num: "rej" },
      quotation_acceptance_rate: { num: "acc", den: "decided" },
    },
    dimensions: ["decision", "owner", "channel", "customer"],
    drill: { valuePart: "value" },
  },
  orders: {
    key: "orders",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "sales_orders", "view"))) return null;
      return Prisma.sql`
        SELECT so.id, so.order_number AS ref, so.order_date AS tf, so.updated_at AS upd,
          so.sales_rep_user_id::text AS d_rep, so.sales_territory_id::text AS d_territory, so.sales_channel_id::text AS d_channel,
          so.customer_id::text AS d_customer, so.campaign_id::text AS d_campaign,
          CASE WHEN so.source_quotation_revision_id IS NULL THEN 'DIRECT' ELSE 'QUOTATION' END AS d_origin,
          so.status::text AS d_status,
          1 AS p_one, so.base_total_amount AS p_value
        FROM sales_orders so
        WHERE so.company_id = ${ctx.actor.companyId}::uuid
          AND so.order_date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
          AND ${bookedOrderSql("so")}
          ${await branchSql(ctx.actor.userId, "so.branch_id")}`;
    },
    parts: { booked_order_count: { num: "one" }, booked_order_value: { num: "value" }, avg_order_value: { num: "value", den: "one" } },
    dimensions: ["rep", "territory", "channel", "customer", "campaign", "origin", "status"],
    drill: { valuePart: "value" },
  },
  invoices: {
    key: "invoices",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "accounts", "view"))) return null;
      return Prisma.sql`
        SELECT si.id, si.invoice_number AS ref, si.invoice_date AS tf, si.updated_at AS upd,
          si.customer_id::text AS d_customer, so.sales_rep_user_id::text AS d_rep, si.status::text AS d_status,
          1 AS p_one, ROUND(si.subtotal_amount * si.exchange_rate, 2) AS p_value, si.base_total_amount AS p_value_tax
        FROM sales_invoices si
        JOIN sales_orders so ON so.id = si.sales_order_id
        WHERE si.company_id = ${ctx.actor.companyId}::uuid
          AND si.status::text IN (${Prisma.join([...INVOICED_STATUSES])})
          AND si.invoice_date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
          ${await branchSql(ctx.actor.userId, "si.branch_id")}`;
    },
    parts: { invoice_count: { num: "one" }, invoiced_value: { num: "value" }, invoiced_value_incl_tax: { num: "value_tax" } },
    dimensions: ["customer", "rep", "status"],
    drill: { valuePart: "value" },
  },
  payments: {
    key: "payments",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "accounts", "view"))) return null;
      return Prisma.sql`
        SELECT p.id, p.payment_number AS ref, p.payment_date AS tf, p.updated_at AS upd,
          p.customer_id::text AS d_customer, 1 AS p_one, p.amount AS p_value
        FROM payments p
        WHERE p.company_id = ${ctx.actor.companyId}::uuid
          AND p.direction::text = 'RECEIPT' AND p.status::text = 'POSTED'
          AND p.payment_date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
          ${await branchSql(ctx.actor.userId, "p.branch_id")}`;
    },
    parts: { cash_collected: { num: "value" } },
    dimensions: ["customer"],
    drill: { valuePart: "value" },
  },
  workflows: {
    key: "workflows",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "sales_workflows", "view"))) return null;
      const { start, end } = istBounds(ctx.from, ctx.to);
      return Prisma.sql`
        SELECT wi.id, COALESCE(wi.entity_label, wi.workflow_key) AS ref, ${istDate("wi.started_at")} AS tf, wi.updated_at AS upd,
          wi.workflow_key AS d_workflow, wi.status AS d_status,
          1 AS p_one,
          ${flag(Prisma.sql`wi.status = 'COMPLETED'`)} AS p_completed,
          ${flag(Prisma.sql`wi.status IN ('FAILED', 'NEEDS_ATTENTION')`)} AS p_problem,
          CASE WHEN wi.status = 'COMPLETED' THEN EXTRACT(EPOCH FROM (wi.completed_at - wi.started_at)) / 3600 ELSE 0 END AS p_hours,
          COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (s.finished_at - s.started_at))) / 3600 FROM sm_workflow_step_runs s WHERE s.instance_id = wi.id AND s.step_key = 'await_approval' AND s.status = 'DONE'), 0) AS p_wait_hours,
          (SELECT COUNT(*) FROM sm_workflow_step_runs s WHERE s.instance_id = wi.id AND s.step_key = 'await_approval' AND s.status = 'DONE') AS p_wait_n
        FROM sm_workflow_instances wi
        WHERE wi.company_id = ${ctx.actor.companyId}::uuid
          AND wi.started_at >= ${start} AND wi.started_at < ${end}`;
    },
    parts: {
      workflow_count: { num: "one" },
      workflow_completed: { num: "completed" },
      workflow_problem: { num: "problem" },
      workflow_completion_hours: { num: "hours", den: "completed" },
      approval_wait_hours: { num: "wait_hours", den: "wait_n" },
    },
    dimensions: ["workflow", "status"],
  },
  bulk: {
    key: "bulk",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "sales_marketing", "view"))) return null;
      // Same rule as the Bulk jobs page: S&M admins see every S&M job, others their own.
      const admin = await PermissionService.can(ctx.actor.userId, "sales_marketing_settings", "edit");
      const { start, end } = istBounds(ctx.from, ctx.to);
      return Prisma.sql`
        SELECT bj.id, bj.action_key AS ref, ${istDate("bj.created_at")} AS tf, bj.updated_at AS upd,
          bj.entity_type AS d_recordType, bj.action_key AS d_action, bj.status::text AS d_status,
          1 AS p_one, bj.processed_count AS p_processed, bj.succeeded_count AS p_succ, (bj.succeeded_count + bj.failed_count) AS p_succfail
        FROM bulk_jobs bj
        WHERE bj.company_id = ${ctx.actor.companyId}::uuid
          AND bj.dry_run = FALSE
          AND bj.entity_type IN ('ENQUIRY', 'QUOTATION', 'CAMPAIGN', 'PROMOTION', 'ATTRIBUTION_MODEL')
          AND bj.created_at >= ${start} AND bj.created_at < ${end}
          ${admin ? Prisma.empty : Prisma.sql`AND bj.requested_by_user_id = ${ctx.actor.userId}::uuid`}`;
    },
    parts: { bulk_job_count: { num: "one" }, bulk_items_processed: { num: "processed" }, bulk_item_success_rate: { num: "succ", den: "succfail" } },
    dimensions: ["recordType", "action", "status"],
  },
  webhooks: {
    key: "webhooks",
    base: async (ctx) => {
      if (!(await PermissionService.can(ctx.actor.userId, "sales_integrations", "view"))) return null;
      const { start, end } = istBounds(ctx.from, ctx.to);
      return Prisma.sql`
        SELECT d.id, d.event_type AS ref, ${istDate("d.created_at")} AS tf, COALESCE(d.last_attempt_at, d.created_at) AS upd,
          d.event_type AS d_eventType, d.status AS d_status,
          1 AS p_one, ${flag(Prisma.sql`d.status = 'FAILED'`)} AS p_failed, ${flag(Prisma.sql`d.status IN ('SUCCEEDED', 'FAILED')`)} AS p_finished
        FROM crm_webhook_deliveries d
        WHERE d.company_id = ${ctx.actor.companyId}::uuid
          AND d.event_source = 'INTEGRATION' AND d.is_test = FALSE
          AND d.created_at >= ${start} AND d.created_at < ${end}`;
    },
    parts: { webhook_deliveries: { num: "one" }, webhook_failure_rate: { num: "failed", den: "finished" } },
    dimensions: ["eventType", "status"],
  },
};

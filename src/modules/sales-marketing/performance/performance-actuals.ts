import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { getTeamScope } from "@/core/hierarchy/team-scope";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { BOOKED_ORDER_STATUSES, INVOICED_STATUSES, metricDefinition, type SalesTargetMetricKey } from "./performance-registry";

/**
 * The one place that calculates sales performance actuals (Phase 05,
 * PHASE_05 §4). Targets, the performance board, drill-downs and reports all
 * call these functions — nothing else re-implements a metric. Everything is
 * read live from the source tables (Sales Orders, Quotation revisions, Sales
 * Invoices); nothing is copied or cached.
 */

export type Grouping = "REP" | "TERRITORY" | "CHANNEL" | "TOTAL";
export interface MetricTotal {
  value: number;
  /** Number of source documents behind the value. */
  documents: number;
}
/** Key = rep user id / territory id / channel id (Phase 07) / "TOTAL"; "" = none. */
export type MetricTotals = Map<string, MetricTotal>;

const bookedOrderSql = (alias: string) =>
  Prisma.sql`(${Prisma.raw(alias)}.status::text IN (${Prisma.join([...BOOKED_ORDER_STATUSES])})
    OR (${Prisma.raw(alias)}.status::text = 'ON_HOLD' AND ${Prisma.raw(alias)}.status_before_hold::text IN (${Prisma.join([...BOOKED_ORDER_STATUSES])})))`;

/** Prisma filter equal to `bookedOrderSql` (drill-downs). */
export const bookedOrderWhere: Prisma.SalesOrderWhereInput = {
  OR: [{ status: { in: [...BOOKED_ORDER_STATUSES] } }, { status: "ON_HOLD", statusBeforeHold: { in: [...BOOKED_ORDER_STATUSES] } }],
};

/** [from, to] inclusive business dates → the half-open timestamp range used for decision dates. */
export function decisionRange(from: string, to: string) {
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: new Date(`${from}T00:00:00.000Z`), lt: end };
}

/** Totals of one metric for [from, to], grouped by rep, territory or not at all. */
export async function metricTotals(companyId: string, metric: SalesTargetMetricKey, from: string, to: string, grouping: Grouping): Promise<MetricTotals> {
  const source = metricDefinition(metric).source;
  let rows: { key: string | null; value: Prisma.Decimal | number | bigint | null; documents: bigint | number }[];

  if (source === "SALES_ORDER") {
    const key =
      grouping === "REP"
        ? Prisma.sql`so.sales_rep_user_id::text`
        : grouping === "TERRITORY"
          ? Prisma.sql`so.sales_territory_id::text`
          : grouping === "CHANNEL"
            ? Prisma.sql`so.sales_channel_id::text`
            : Prisma.sql`'TOTAL'`;
    const value =
      metric === "BOOKED_ORDER_VALUE"
        ? Prisma.sql`SUM(so.base_total_amount)`
        : metric === "BOOKED_ORDER_COUNT"
          ? Prisma.sql`COUNT(*)`
          : Prisma.sql`SUM((SELECT COALESCE(SUM(b.ordered_quantity), 0) FROM sales_order_items i JOIN sales_order_item_breakdown b ON b.sales_order_item_id = i.id WHERE i.sales_order_id = so.id))`;
    rows = await prisma.$queryRaw`
      SELECT ${key} AS key, ${value} AS value, COUNT(*) AS documents
      FROM sales_orders so
      WHERE so.company_id = ${companyId}::uuid
        AND so.order_date BETWEEN ${from}::date AND ${to}::date
        AND ${bookedOrderSql("so")}
      GROUP BY 1`;
  } else if (source === "QUOTATION") {
    const key =
      grouping === "REP"
        ? Prisma.sql`COALESCE(q.owner_user_id, q.created_by_user_id)::text`
        : grouping === "TERRITORY"
          ? Prisma.sql`c.sales_territory_id::text`
          : grouping === "CHANNEL"
            ? Prisma.sql`q.sales_channel_id::text`
            : Prisma.sql`'TOTAL'`;
    const value = metric === "ACCEPTED_QUOTATION_VALUE" ? Prisma.sql`SUM(qr.taxable_total)` : Prisma.sql`COUNT(*)`;
    const range = decisionRange(from, to);
    rows = await prisma.$queryRaw`
      SELECT ${key} AS key, ${value} AS value, COUNT(*) AS documents
      FROM quotation_revisions qr
      JOIN quotations q ON q.id = qr.quotation_id
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE q.company_id = ${companyId}::uuid
        AND qr.status::text = 'ACCEPTED'
        AND qr.customer_decision_at >= ${range.gte} AND qr.customer_decision_at < ${range.lt}
      GROUP BY 1`;
  } else {
    const key =
      grouping === "REP"
        ? Prisma.sql`so.sales_rep_user_id::text`
        : grouping === "TERRITORY"
          ? Prisma.sql`so.sales_territory_id::text`
          : grouping === "CHANNEL"
            ? Prisma.sql`so.sales_channel_id::text`
            : Prisma.sql`'TOTAL'`;
    rows = await prisma.$queryRaw`
      SELECT ${key} AS key, SUM(ROUND(si.subtotal_amount * si.exchange_rate, 2)) AS value, COUNT(*) AS documents
      FROM sales_invoices si
      JOIN sales_orders so ON so.id = si.sales_order_id
      WHERE si.company_id = ${companyId}::uuid
        AND si.status::text IN (${Prisma.join([...INVOICED_STATUSES])})
        AND si.invoice_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1`;
  }

  const out: MetricTotals = new Map();
  for (const r of rows) out.set(r.key ?? "", { value: Number(r.value ?? 0), documents: Number(r.documents) });
  return out;
}

/** Sum of the given keys of a totals map (team totals: each order is credited to one rep, so no double counting). */
export function sumKeys(totals: MetricTotals, keys: Iterable<string>): MetricTotal {
  let value = 0;
  let documents = 0;
  for (const k of new Set(keys)) {
    const t = totals.get(k);
    if (t) {
      value += t.value;
      documents += t.documents;
    }
  }
  return { value: Math.round(value * 100) / 100, documents };
}

export function grandTotal(totals: MetricTotals): MetricTotal {
  return sumKeys(totals, totals.keys());
}

// ── Visibility (PHASE_05 §7) ─────────────────────────────────────

export interface PerformanceScope {
  userId: string;
  viewAll: boolean;
  /** The viewer and everyone below them in the CRM reporting tree. */
  visibleRepIds: Set<string>;
  /** Users below the viewer (not the viewer). */
  teamUserIds: string[];
  /** Territories the viewer is assigned to today. */
  assignedTerritoryIds: Set<string>;
}

export async function getPerformanceScope(actor: SalesActor): Promise<PerformanceScope> {
  const today = new Date(`${todayIsoDate()}T00:00:00.000Z`);
  const [viewAll, team, assignments] = await Promise.all([
    PermissionService.can(actor.userId, "sales_performance", "view_all"),
    getTeamScope(actor.userId, "CRM"),
    prisma.salesTerritoryAssignment.findMany({
      where: { companyId: actor.companyId, userId: actor.userId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      select: { territoryId: true },
    }),
  ]);
  return {
    userId: actor.userId,
    viewAll,
    visibleRepIds: new Set([actor.userId, ...team.teamUserIds]),
    teamUserIds: team.teamUserIds,
    assignedTerritoryIds: new Set(assignments.map((a) => a.territoryId)),
  };
}

export const canSeeRep = (scope: PerformanceScope, userId: string) => scope.viewAll || scope.visibleRepIds.has(userId);
export const canSeeTerritory = (scope: PerformanceScope, territoryId: string) => scope.viewAll || scope.assignedTerritoryIds.has(territoryId);
/** A team is visible when its manager is visible (a member's team is part of the viewer's team). */
export const canSeeTeam = (scope: PerformanceScope, managerUserId: string) => canSeeRep(scope, managerUserId);

/** The manager plus everyone below them in the CRM reporting tree (login users). */
export async function teamMemberIds(managerUserId: string): Promise<string[]> {
  const team = await getTeamScope(managerUserId, "CRM");
  return [managerUserId, ...team.teamUserIds];
}

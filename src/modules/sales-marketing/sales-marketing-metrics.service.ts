import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import { round2 } from "@/lib/money";
import { getSalesEnquiryScope, scopedWhere as enquiryScopedWhere, type SalesActor } from "./enquiries/sales-enquiry.service";
import { OPEN_STAGE_KEYS } from "./enquiries/sales-enquiry-registry";
import { getQuotationScope, scopedWhere as quotationScopedWhere } from "./quotations/quotation.service";

/**
 * Sales & Marketing dashboard KPIs (Release 1 / S6, 2026-11-02). Every figure
 * is computed from real records, in the viewer's own visibility scope (the
 * same rule as the enquiry / quotation lists), and only for areas the viewer
 * can see. Definitions (also shown on the dashboard):
 *
 *  Enquiries (sales_marketing.view)
 *   - open: stage not Won / Lost / Not qualified, not cancelled in Merchandising
 *   - overdue follow-ups: open, next follow-up date before today
 *   - awaiting qualification: open at New or Under review
 *   - enquiry → quotation rate: enquiries dated in the period that have at
 *     least one quotation that was issued (any revision), ÷ enquiries dated in
 *     the period
 *  Quotations (sales_quotations.view) — values are the current revision's
 *  grand total incl. GST
 *   - by status now: Draft, Pending approval, Approved (not issued), Issued
 *     awaiting decision (not expired), Expired (issued, valid-until before
 *     today), Accepted (awaiting conversion)
 *   - win rate: customer decisions recorded in the period — accepted ÷
 *     (accepted + rejected), counted per revision
 *   - quote → order: revisions accepted in the period that already have a
 *     Sales Order ÷ revisions accepted in the period
 *   - top customers: accepted value in the period
 *  Orders from quotations (sales_orders.view, branch scope like its list):
 *   - Sales Orders created from a quotation in the period: count and value
 *     (order value, before GST)
 */

export const METRIC_PERIODS = [30, 90, 365] as const;
export type MetricPeriod = (typeof METRIC_PERIODS)[number];

const ISSUED_REVISION = { revisions: { some: { issuedAt: { not: null } } } };

export interface QuotationStatusFigure {
  key: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ISSUED" | "EXPIRED" | "ACCEPTED";
  label: string;
  count: number;
  value: number;
}

export interface SalesMarketingMetrics {
  periodDays: MetricPeriod;
  periodFrom: string;
  today: string;
  enquiries: {
    open: number;
    overdueFollowUps: number;
    awaitingQualification: number;
    receivedInPeriod: number;
    quotedInPeriod: number;
    quotationRate: number | null;
  } | null;
  quotations: {
    byStatus: QuotationStatusFigure[];
    decisions: { accepted: number; rejected: number; winRate: number | null };
    conversion: { accepted: number; converted: number; rate: number | null };
    topCustomers: { customerId: string; name: string; accepted: number; value: number }[];
  } | null;
  orders: { count: number; value: number } | null;
}

const pct = (part: number, whole: number) => (whole > 0 ? round2((part / whole) * 100) : null);

export function periodStart(days: number, today = todayIsoDate()): string {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - (days - 1));
  return toIsoDate(d);
}

export async function getSalesMarketingMetrics(actor: SalesActor, days: number = 90): Promise<SalesMarketingMetrics> {
  const periodDays = (METRIC_PERIODS as readonly number[]).includes(days) ? (days as MetricPeriod) : 90;
  const today = todayIsoDate();
  const periodFrom = periodStart(periodDays, today);
  const from = new Date(periodFrom);
  const todayDate = new Date(today);
  const [canEnquiries, canQuotations, canOrders] = await Promise.all([
    PermissionService.can(actor.userId, "sales_marketing", "view"),
    PermissionService.can(actor.userId, "sales_quotations", "view"),
    PermissionService.can(actor.userId, "sales_orders", "view"),
  ]);

  const enquiries = canEnquiries
    ? await (async () => {
        const scope = await getSalesEnquiryScope(actor);
        const w = (extra: object) => enquiryScopedWhere(actor, scope, extra);
        const open = { salesStage: { in: OPEN_STAGE_KEYS }, status: { not: "CANCELLED" as const } };
        const [openCount, overdue, awaiting, received, quoted] = await Promise.all([
          prisma.buyerEnquiry.count({ where: w(open) }),
          prisma.buyerEnquiry.count({ where: w({ ...open, nextFollowUpDate: { lt: todayDate } }) }),
          prisma.buyerEnquiry.count({ where: w({ ...open, salesStage: { in: ["NEW", "UNDER_REVIEW"] } }) }),
          prisma.buyerEnquiry.count({ where: w({ enquiryDate: { gte: from } }) }),
          prisma.buyerEnquiry.count({ where: w({ enquiryDate: { gte: from }, quotations: { some: ISSUED_REVISION } }) }),
        ]);
        return { open: openCount, overdueFollowUps: overdue, awaitingQualification: awaiting, receivedInPeriod: received, quotedInPeriod: quoted, quotationRate: pct(quoted, received) };
      })()
    : null;

  const quotations = canQuotations
    ? await (async () => {
        const scope = await getQuotationScope(actor);
        // Current revision = highest revision number.
        const openRows = await prisma.quotation.findMany({
          where: quotationScopedWhere(actor, scope, { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACCEPTED"] } }),
          select: { status: true, revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { grandTotal: true, validUntil: true } } },
        });
        const labels: Record<QuotationStatusFigure["key"], string> = {
          DRAFT: "Draft",
          PENDING_APPROVAL: "Waiting for approval",
          APPROVED: "Approved, not issued",
          ISSUED: "Issued, awaiting decision",
          EXPIRED: "Expired (issued)",
          ACCEPTED: "Accepted, not yet ordered",
        };
        const figures = new Map<QuotationStatusFigure["key"], { count: number; value: number }>(Object.keys(labels).map((k) => [k as QuotationStatusFigure["key"], { count: 0, value: 0 }]));
        for (const q of openRows) {
          const rev = q.revisions[0];
          const key: QuotationStatusFigure["key"] = q.status === "ISSUED" && rev && toIsoDate(rev.validUntil) < today ? "EXPIRED" : (q.status as QuotationStatusFigure["key"]);
          const f = figures.get(key)!;
          f.count += 1;
          f.value += rev ? Number(rev.grandTotal) : 0;
        }
        const decided = await prisma.quotationRevision.findMany({
          where: { companyId: actor.companyId, customerDecisionAt: { gte: from }, status: { in: ["ACCEPTED", "REJECTED"] }, quotation: quotationScopedWhere(actor, scope) },
          select: { status: true, grandTotal: true, salesOrder: { select: { id: true } }, quotation: { select: { customerId: true, customer: { select: { name: true } } } } },
        });
        const accepted = decided.filter((r) => r.status === "ACCEPTED");
        const rejected = decided.length - accepted.length;
        const converted = accepted.filter((r) => r.salesOrder).length;
        const byCustomer = new Map<string, { customerId: string; name: string; accepted: number; value: number }>();
        for (const r of accepted) {
          if (!r.quotation.customerId) continue;
          const c = byCustomer.get(r.quotation.customerId) ?? { customerId: r.quotation.customerId, name: r.quotation.customer?.name ?? "—", accepted: 0, value: 0 };
          c.accepted += 1;
          c.value += Number(r.grandTotal);
          byCustomer.set(c.customerId, c);
        }
        return {
          byStatus: [...figures.entries()].map(([key, f]) => ({ key, label: labels[key], count: f.count, value: round2(f.value) })),
          decisions: { accepted: accepted.length, rejected, winRate: pct(accepted.length, decided.length) },
          conversion: { accepted: accepted.length, converted, rate: pct(converted, accepted.length) },
          topCustomers: [...byCustomer.values()]
            .map((c) => ({ ...c, value: round2(c.value) }))
            .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
            .slice(0, 5),
        };
      })()
    : null;

  const orders = canOrders
    ? await (async () => {
        const allowed = await PermissionService.getAllowedBranchIds(actor.userId);
        const agg = await prisma.salesOrder.aggregate({
          where: { companyId: actor.companyId, ...branchScopeWhere(allowed), sourceQuotationRevisionId: { not: null }, createdAt: { gte: from } },
          _count: { _all: true },
          _sum: { totalAmount: true },
        });
        return { count: agg._count._all, value: round2(Number(agg._sum.totalAmount ?? 0)) };
      })()
    : null;

  return { periodDays, periodFrom, today, enquiries, quotations, orders };
}

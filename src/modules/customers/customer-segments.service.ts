import { prisma } from "@/core/db/client";

/**
 * Customer segmentation, deliberately scoped to what's real in this schema
 * (per the CRM/Marketing enhancement audit): `Customer.type` is a plain
 * string (only "CUSTOMER"/"AGENT" in practice, not the fuller retail/
 * wholesale/distributor/export list the request described) and there's no
 * Region master (`Customer.country` is free text) — inventing either as a
 * side effect of a segmentation feature would be scope creep. What IS real
 * and derivable: order recency, frequency, and value from `SalesOrder`, plus
 * the existing `type`/`country` fields as plain filters/groupings.
 *
 * High Value / VIP are percentile-based (top 20% / top 5% of total order
 * value among customers who have ordered at all) rather than a hardcoded
 * rupee threshold — a fixed number would need manual re-tuning as the
 * business grows and has no natural "right" value to pick today.
 */
const NEW_CUSTOMER_WINDOW_DAYS = 30;
const DORMANT_WINDOW_DAYS = 90;
const HIGH_VALUE_PERCENTILE = 0.2;
const VIP_PERCENTILE = 0.05;

export const CUSTOMER_SEGMENTS = ["NEW", "REPEAT", "HIGH_VALUE", "VIP", "DORMANT", "INACTIVE"] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export interface CustomerSegmentRow {
  id: string;
  code: string;
  name: string;
  type: string;
  country: string | null;
  createdAt: string;
  orderCount: number;
  totalOrderValue: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  segments: CustomerSegment[];
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

export async function getCustomerSegments(companyId: string): Promise<CustomerSegmentRow[]> {
  const now = new Date();

  const [customers, orders] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, name: true, type: true, country: true, createdAt: true },
    }),
    prisma.salesOrder.findMany({
      where: { companyId, status: { not: "CANCELLED" } },
      select: { customerId: true, totalAmount: true, orderDate: true },
    }),
  ]);

  const statsByCustomer = new Map<string, { count: number; total: number; lastOrderDate: Date | null }>();
  for (const o of orders) {
    const s = statsByCustomer.get(o.customerId) ?? { count: 0, total: 0, lastOrderDate: null };
    s.count += 1;
    s.total += Number(o.totalAmount);
    if (!s.lastOrderDate || o.orderDate > s.lastOrderDate) s.lastOrderDate = o.orderDate;
    statsByCustomer.set(o.customerId, s);
  }

  const totalsWithOrders = [...statsByCustomer.values()].map((s) => s.total).sort((a, b) => b - a);
  const percentileValue = (percentile: number) =>
    totalsWithOrders.length ? totalsWithOrders[Math.max(0, Math.floor(totalsWithOrders.length * percentile) - 1)] : Infinity;
  const highValueThreshold = percentileValue(HIGH_VALUE_PERCENTILE);
  const vipThreshold = percentileValue(VIP_PERCENTILE);

  return customers.map((c) => {
    const stats = statsByCustomer.get(c.id) ?? { count: 0, total: 0, lastOrderDate: null };
    const daysSinceLastOrder = stats.lastOrderDate ? daysBetween(stats.lastOrderDate, now) : null;
    const daysSinceCreated = daysBetween(c.createdAt, now);

    const segments: CustomerSegment[] = [];
    if (daysSinceCreated <= NEW_CUSTOMER_WINDOW_DAYS) segments.push("NEW");
    if (stats.count >= 2) segments.push("REPEAT");
    if (stats.count === 0 && daysSinceCreated > NEW_CUSTOMER_WINDOW_DAYS) segments.push("INACTIVE");
    if (stats.count > 0 && daysSinceLastOrder !== null && daysSinceLastOrder > DORMANT_WINDOW_DAYS) segments.push("DORMANT");
    if (stats.count > 0 && stats.total >= vipThreshold) {
      segments.push("VIP");
    } else if (stats.count > 0 && stats.total >= highValueThreshold) {
      segments.push("HIGH_VALUE");
    }

    return {
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      country: c.country,
      createdAt: c.createdAt.toISOString(),
      orderCount: stats.count,
      totalOrderValue: stats.total,
      lastOrderDate: stats.lastOrderDate ? stats.lastOrderDate.toISOString() : null,
      daysSinceLastOrder,
      segments,
    };
  });
}

export interface CategoryPurchaseRow {
  categoryId: string;
  categoryName: string;
  customerCount: number;
  orderCount: number;
}

/** "By Product Category" — real and derivable via SalesOrder -> SalesOrderItem
 * -> Product.category, the one dimension from the request's own list that
 * needed no schema change at all (Category is already a real, wired master). */
export async function getCategoryPurchaseBreakdown(companyId: string): Promise<CategoryPurchaseRow[]> {
  const items = await prisma.salesOrderItem.findMany({
    where: { salesOrder: { companyId, status: { not: "CANCELLED" } } },
    select: {
      salesOrderId: true,
      salesOrder: { select: { customerId: true } },
      product: { select: { categoryId: true, category: { select: { name: true } } } },
    },
  });

  const byCategory = new Map<string, { categoryName: string; customers: Set<string>; orders: Set<string> }>();
  for (const item of items) {
    if (!item.product.categoryId) continue;
    const entry = byCategory.get(item.product.categoryId) ?? {
      categoryName: item.product.category?.name ?? "Uncategorized",
      customers: new Set<string>(),
      orders: new Set<string>(),
    };
    entry.customers.add(item.salesOrder.customerId);
    entry.orders.add(item.salesOrderId);
    byCategory.set(item.product.categoryId, entry);
  }

  return [...byCategory.entries()]
    .map(([categoryId, v]) => ({ categoryId, categoryName: v.categoryName, customerCount: v.customers.size, orderCount: v.orders.size }))
    .sort((a, b) => b.customerCount - a.customerCount);
}

// The request's own example number ("Customer Inactive 60 Days") — kept
// deliberately distinct from DORMANT_WINDOW_DAYS (90) above: the segments
// dashboard's "Dormant" bucket is a reporting/labeling threshold, this is a
// separate action threshold the request specified explicitly.
const REENGAGEMENT_INACTIVE_DAYS = 60;

/**
 * Marketing automation trigger: "Customer Inactive 60 Days -> Create
 * Re-engagement Task" from the request's own example list. Manual, not a
 * background cron — this project has no job runner, matching the same
 * "Run Automation Now" / "Check for Due Follow-ups" manual-trigger
 * convention already used for Marketing's and CRM's own automation.
 * Dedup is "does this customer already have ANY open follow-up" rather than
 * a re-engagement-specific marker — the goal is one open task per customer,
 * not a pile of re-engagement reminders stacking on top of other pending work.
 */
export async function generateReengagementFollowups(companyId: string, createdByUserId: string) {
  const segments = await getCustomerSegments(companyId);
  const candidates = segments.filter(
    (c) => c.orderCount > 0 && c.daysSinceLastOrder !== null && c.daysSinceLastOrder >= REENGAGEMENT_INACTIVE_DAYS
  );

  let created = 0;
  for (const c of candidates) {
    const existingOpen = await prisma.crmFollowup.findFirst({
      where: { companyId, relatedModule: "CUSTOMER", relatedRecordId: c.id, status: "PENDING" },
      select: { id: true },
    });
    if (existingOpen) continue;

    await prisma.crmFollowup.create({
      data: {
        companyId,
        relatedModule: "CUSTOMER",
        relatedRecordId: c.id,
        followupDate: new Date(),
        type: "CALL",
        priority: "MEDIUM",
        notes: `Auto-created — re-engagement outreach: ${c.name} has not ordered in ${c.daysSinceLastOrder} days.`,
        createdByUserId,
      },
    });
    created++;
  }

  return { checked: candidates.length, created };
}

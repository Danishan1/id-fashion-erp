import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { toIsoDate } from "@/lib/date";
import type { PricingSnapshot } from "@/modules/sales-marketing/pricing/pricing-snapshot";
import { usageCount } from "./promotion-eligibility";

/**
 * Promotion usage (Phase 12), tied to the authoritative quotation → Sales
 * Order lifecycle. Pricing a draft never uses a promotion.
 *
 *   issue revision       → RESERVED (counts against limits until the quotation's valid-until)
 *   customer accepts     → still RESERVED, no longer expires
 *   converted to order   → REDEEMED (+ the Sales Order)
 *   rejected / cancelled / revised (superseded) / expired → RELEASED
 *   Sales Order cancelled → REDEEMED → RELEASED (the limit is given back)
 *
 * Limits are checked under a row lock on the promotion (FOR UPDATE), and a
 * revision can hold only one row per promotion (unique) — so concurrent
 * issues can't go over a limit, and retries can't count twice.
 */

type Tx = Prisma.TransactionClient;
type Actor = { companyId: string; userId: string };
const NEVER = new Date("9999-12-31T00:00:00Z");

/** Promotions applied on a revision's lines, with the discount each gave (₹, qty × per-unit, before GST). */
export function promotionsOnLines(lines: { quantity: Prisma.Decimal | number | string; pricing: unknown; priceSource: string }[]) {
  const by = new Map<string, { promotionId: string; versionId: string; code: string; discount: Prisma.Decimal }>();
  for (const l of lines) {
    // Only lines priced by the engine carry a promotion; an overridden price doesn't.
    if (l.priceSource !== "PRICE_LIST" || !l.pricing || typeof l.pricing !== "object" || !("rules" in l.pricing)) continue;
    const snap = l.pricing as unknown as PricingSnapshot;
    for (const r of snap.rules ?? []) {
      if (!r.promotionId || !r.promotionVersionId) continue;
      const cur = by.get(r.promotionId) ?? { promotionId: r.promotionId, versionId: r.promotionVersionId, code: r.code, discount: new Prisma.Decimal(0) };
      cur.discount = cur.discount.add(new Prisma.Decimal(r.discountPerUnit).mul(new Prisma.Decimal(l.quantity)));
      by.set(r.promotionId, cur);
    }
  }
  return [...by.values()].map((x) => ({ ...x, discount: x.discount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) }));
}

/** Reserve the promotions an issued revision uses. Throws if a limit was reached meanwhile. */
export async function reserveForRevision(
  tx: Tx,
  actor: Actor,
  q: { id: string; quotationNumber: string; customerId: string | null },
  revision: { id: string; validUntil: Date },
  lines: Parameters<typeof promotionsOnLines>[0]
) {
  const used = promotionsOnLines(lines).sort((a, b) => a.promotionId.localeCompare(b.promotionId)); // lock order: no deadlocks
  for (const u of used) {
    await tx.$queryRaw`SELECT id FROM marketing_promotions WHERE id = ${u.promotionId}::uuid FOR UPDATE`;
    const p = await tx.marketingPromotion.findUniqueOrThrow({ where: { id: u.promotionId }, include: { approvedVersion: true } });
    const v = await tx.marketingPromotionVersion.findUniqueOrThrow({ where: { id: u.versionId } });
    const stale = () => new BusinessRuleError("VALIDATION_ERROR", `Promotion ${p.code} changed since the prices were worked out. Return the quotation to draft and save it again.`);
    if (p.status !== "ACTIVE" || p.approvedVersionId !== v.id) throw stale();
    const day = toIsoDate(new Date());
    if (v.maxRedemptions !== null && (await usageCount(tx, p.id, { excludeRevisionId: revision.id, today: day })) >= v.maxRedemptions) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Promotion ${p.code} reached its limit of ${v.maxRedemptions} just now. Return the quotation to draft and save it again to price it without the promotion.`);
    }
    if (v.maxRedemptionsPerCustomer !== null && q.customerId && (await usageCount(tx, p.id, { customerId: q.customerId, excludeRevisionId: revision.id, today: day })) >= v.maxRedemptionsPerCustomer) {
      throw new BusinessRuleError("VALIDATION_ERROR", `This customer reached the limit for promotion ${p.code}. Return the quotation to draft and save it again.`);
    }
    // Retry-safe: an existing reservation of this revision is left as it is.
    const row = await tx.marketingPromotionRedemption.upsert({
      where: { promotionId_quotationRevisionId: { promotionId: p.id, quotationRevisionId: revision.id } },
      create: { companyId: actor.companyId, promotionId: p.id, promotionVersionId: v.id, quotationId: q.id, quotationRevisionId: revision.id, customerId: q.customerId, status: "RESERVED", discountAmount: u.discount, expiresOn: revision.validUntil },
      update: {},
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "marketing_promotion_redemptions", recordId: row.id, action: "CREATE", newValues: { promotion: p.code, version: v.versionNumber, quotation: q.quotationNumber, status: "RESERVED", discount: u.discount.toString() } }, tx);
  }
  return used.length;
}

/** Accepted by the customer: the reservation no longer runs out on the valid-until date. */
export async function holdForAcceptedRevision(tx: Tx, revisionId: string) {
  await tx.marketingPromotionRedemption.updateMany({ where: { quotationRevisionId: revisionId, status: "RESERVED" }, data: { expiresOn: NEVER } });
}

export async function redeemForOrder(tx: Tx, actor: Actor, quotationId: string, salesOrderId: string) {
  const rows = await tx.marketingPromotionRedemption.findMany({ where: { quotationId, status: "RESERVED" } });
  if (!rows.length) return 0;
  await tx.marketingPromotionRedemption.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "RESERVED" }, data: { status: "REDEEMED", redeemedAt: new Date(), salesOrderId } });
  for (const r of rows) await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "marketing_promotion_redemptions", recordId: r.id, action: "UPDATE", oldValues: { status: "RESERVED" }, newValues: { status: "REDEEMED", salesOrderId } }, tx);
  return rows.length;
}

/** Give back what a quotation (or one of its revisions) held: rejected, cancelled, superseded. */
export async function releaseForQuotation(tx: Tx, actor: Actor, where: { quotationId?: string; quotationRevisionId?: string }, reason: string) {
  const rows = await tx.marketingPromotionRedemption.findMany({ where: { ...where, status: "RESERVED" }, select: { id: true } });
  if (!rows.length) return 0;
  await tx.marketingPromotionRedemption.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "RESERVED" }, data: { status: "RELEASED", releasedAt: new Date(), releaseReason: reason.slice(0, 300) } });
  for (const r of rows) await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "marketing_promotion_redemptions", recordId: r.id, action: "UPDATE", oldValues: { status: "RESERVED" }, newValues: { status: "RELEASED", reason } }, tx);
  return rows.length;
}

/** A cancelled Sales Order gives its promotions' uses back. */
export async function releaseForSalesOrder(tx: Tx, actor: Actor, salesOrderId: string, reason: string) {
  const rows = await tx.marketingPromotionRedemption.findMany({ where: { salesOrderId, status: "REDEEMED" }, select: { id: true } });
  if (!rows.length) return 0;
  await tx.marketingPromotionRedemption.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "REDEEMED" }, data: { status: "RELEASED", releasedAt: new Date(), releaseReason: reason.slice(0, 300) } });
  for (const r of rows) await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "marketing_promotion_redemptions", recordId: r.id, action: "UPDATE", oldValues: { status: "REDEEMED" }, newValues: { status: "RELEASED", reason } }, tx);
  return rows.length;
}

/** Housekeeping (worker): reservations past their quotation's valid-until stop counting already; mark them released. */
export async function releaseExpiredReservations(now = new Date()) {
  const today = new Date(`${toIsoDate(now)}T00:00:00Z`);
  const { count } = await prisma.marketingPromotionRedemption.updateMany({ where: { status: "RESERVED", expiresOn: { lt: today } }, data: { status: "RELEASED", releasedAt: now, releaseReason: "The quotation's valid-until date passed." } });
  return count;
}

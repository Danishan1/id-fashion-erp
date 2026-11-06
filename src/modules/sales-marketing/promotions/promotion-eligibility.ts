import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { toIsoDate } from "@/lib/date";
import type { EngineRule } from "@/modules/sales-marketing/pricing/pricing-engine";

/**
 * Which promotions may price a transaction (Phase 12). Context-level checks
 * live here — switched on, applies automatically or its code was entered,
 * approved version valid on the date, sales channel, campaign, customer list
 * or customer-segment snapshot, usage limits. The surviving promotions become
 * extra inputs ("rules") of the Phase 03 engine, which checks the line-level
 * conditions and does all the arithmetic. Read-only: evaluating a promotion
 * never reserves or uses it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface PromotionContext {
  companyId: string;
  /** YYYY-MM-DD — the transaction date. */
  date: string;
  /** Null = prospect: promotions limited to customers / segments don't apply. */
  customerId: string | null;
  salesChannelId: string | null;
  campaignId: string | null;
  /** Codes entered on the transaction (upper-case). */
  codes: string[];
  /** The transaction's own reservation (if any) doesn't count against its limits. */
  excludeRevisionId?: string | null;
}

export interface PromotionEligibility {
  /** Engine inputs for the promotions that may apply. */
  rules: EngineRule[];
  /** Promotions that can't apply here, with why (automatic ones and entered codes). */
  notApplicable: { promotionId: string; code: string; reason: string }[];
  /** Entered codes that can't be used, with why. */
  invalidCodes: { code: string; reason: string }[];
}

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const todayUtc = () => toIsoDate(new Date());

/** Reservations that still count (not released, not past their quotation's valid-until) + redemptions. */
export async function usageCount(db: Db, promotionId: string, opts: { customerId?: string | null; excludeRevisionId?: string | null; today?: string } = {}) {
  const today = new Date(`${opts.today ?? todayUtc()}T00:00:00Z`);
  return db.marketingPromotionRedemption.count({
    where: {
      promotionId,
      ...(opts.customerId !== undefined ? { customerId: opts.customerId } : {}),
      ...(opts.excludeRevisionId ? { quotationRevisionId: { not: opts.excludeRevisionId } } : {}),
      OR: [{ status: "REDEEMED" }, { status: "RESERVED", expiresOn: { gte: today } }],
    },
  });
}

export async function promotionsForPricing(ctx: PromotionContext, db: Db = prisma): Promise<PromotionEligibility> {
  const codes = [...new Set(ctx.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const rows = await db.marketingPromotion.findMany({
    where: { companyId: ctx.companyId, OR: [{ status: "ACTIVE", applyMode: "AUTO" }, ...(codes.length ? [{ code: { in: codes } }] : [])] },
    include: { approvedVersion: true },
    take: 500,
  });
  const out: PromotionEligibility = { rules: [], notApplicable: [], invalidCodes: [] };
  const found = new Set(rows.map((r) => r.code));
  for (const c of codes) if (!found.has(c)) out.invalidCodes.push({ code: c, reason: "No promotion has this code." });

  for (const p of rows) {
    const entered = codes.includes(p.code);
    const v = p.approvedVersion;
    const reject = (reason: string) => {
      out.notApplicable.push({ promotionId: p.id, code: p.code, reason });
      if (entered) out.invalidCodes.push({ code: p.code, reason });
    };
    if (p.status !== "ACTIVE" || !v) {
      reject(p.status === "PAUSED" ? "It is paused." : p.status === "ARCHIVED" ? "It has been retired." : "It hasn't been approved and switched on yet.");
      continue;
    }
    if (p.applyMode === "CODE" && !entered) continue; // needs its code — not offered silently
    const from = toIsoDate(v.validFrom);
    const to = v.validTo ? toIsoDate(v.validTo) : null;
    if (from > ctx.date) {
      reject(`It starts on ${day(from)}.`);
      continue;
    }
    if (to && to < ctx.date) {
      reject(`It ended on ${day(to)}.`);
      continue;
    }
    if (v.salesChannelIds.length && (!ctx.salesChannelId || !v.salesChannelIds.includes(ctx.salesChannelId))) {
      reject(ctx.salesChannelId ? "It isn't for this quotation's sales channel." : "It is only for certain sales channels, and this quotation has none.");
      continue;
    }
    if (v.campaignIds.length && (!ctx.campaignId || !v.campaignIds.includes(ctx.campaignId))) {
      reject(ctx.campaignId ? "It isn't for this quotation's campaign." : "It is only for certain campaigns, and this quotation has none.");
      continue;
    }
    if (v.customerIds.length && (!ctx.customerId || !v.customerIds.includes(ctx.customerId))) {
      reject(ctx.customerId ? "It is only for selected customers." : "It is only for selected customers, not prospects.");
      continue;
    }
    if (v.segmentEvaluationId) {
      // The customer-segment snapshot pinned on the version decides eligibility — targeting by
      // segment is separate (Phase 09/10) and never grants a discount by itself.
      const inSnapshot = ctx.customerId ? await db.marketingSegmentSnapshotEntry.findFirst({ where: { evaluationId: v.segmentEvaluationId, recordId: ctx.customerId, outcome: "INCLUDED" }, select: { id: true } }) : null;
      if (!inSnapshot) {
        reject(ctx.customerId ? "The customer isn't in the promotion's customer segment." : "It is only for a customer segment, not prospects.");
        continue;
      }
    }
    if (v.maxRedemptions !== null && (await usageCount(db, p.id, { excludeRevisionId: ctx.excludeRevisionId })) >= v.maxRedemptions) {
      reject(`It has been used ${v.maxRedemptions} time${v.maxRedemptions === 1 ? "" : "s"} — the limit.`);
      continue;
    }
    if (v.maxRedemptionsPerCustomer !== null && ctx.customerId && (await usageCount(db, p.id, { customerId: ctx.customerId, excludeRevisionId: ctx.excludeRevisionId })) >= v.maxRedemptionsPerCustomer) {
      reject(`This customer has already used it ${v.maxRedemptionsPerCustomer} time${v.maxRedemptionsPerCustomer === 1 ? "" : "s"} — the limit.`);
      continue;
    }
    out.rules.push(engineRuleOf(p, v));
  }
  return out;
}

/** An approved version as a Phase 03 engine input. */
export function engineRuleOf(p: { id: string; code: string; name: string }, v: Prisma.MarketingPromotionVersionGetPayload<object>): EngineRule {
  return {
    id: v.id,
    code: p.code,
    name: p.name,
    status: "ACTIVE",
    discountType: v.discountType as EngineRule["discountType"],
    value: v.value.toString(),
    stacking: v.stacking as EngineRule["stacking"],
    priority: v.priority,
    productId: null,
    categoryId: null,
    customerId: null,
    priceListId: null,
    minQuantity: v.minQuantity === null ? null : v.minQuantity.toString(),
    validFrom: toIsoDate(v.validFrom),
    validTo: v.validTo ? toIsoDate(v.validTo) : null,
    promotion: { id: p.id, versionId: v.id, versionNumber: v.versionNumber, code: p.code },
    productIds: v.productIds,
    categoryIds: v.categoryIds,
    excludedProductIds: v.excludedProductIds,
    priceListIds: v.priceListIds,
    minLineValue: v.minLineValue === null ? null : v.minLineValue.toString(),
  };
}

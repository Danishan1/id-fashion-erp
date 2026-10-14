import type { Coupon, Prisma, SubscriptionBillingCycle } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CouponInput, CouponPreviewInput } from "./coupon.schema";

/**
 * Coupons (Platform SaaS Phase 5, PLAT-026/027). A coupon IS the offer.
 * Platform staff apply one when recording a payment (percent / fixed amount
 * off, or free extra months) or when creating a company (longer trial).
 * Every use is a coupon_redemptions row; limits are checked with the coupon
 * row locked so two simultaneous uses can't both take the last redemption.
 * Coupons are platform-wide (no company), so like plans they carry
 * created-by instead of audit_logs rows; each use is audited on the payment.
 */

export interface PlatformActor {
  platformUserId: string;
}

function toDates(input: CouponInput) {
  return {
    validFrom: input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : null,
    validUntil: input.validUntil ? new Date(`${input.validUntil}T23:59:59.999Z`) : null,
  };
}

async function assertPlansExist(planIds: string[]) {
  if (planIds.length === 0) return;
  const count = await prisma.subscriptionPlan.count({ where: { id: { in: planIds } } });
  if (count !== new Set(planIds).size) throw new BusinessRuleError("NOT_FOUND", "One of the selected plans doesn't exist.");
}

export async function listCoupons() {
  const coupons = await prisma.coupon.findMany({
    include: {
      plans: { include: { plan: { select: { id: true, name: true } } } },
      _count: { select: { redemptions: true } },
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return coupons;
}

export async function getCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: {
      plans: { include: { plan: { select: { id: true, name: true } } } },
      redemptions: {
        include: {
          company: { select: { id: true, name: true } },
          payment: { select: { id: true, amount: true, paidAt: true } },
          redeemedBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      _count: { select: { redemptions: true } },
    },
  });
  if (!coupon) throw new BusinessRuleError("NOT_FOUND", "Coupon not found.");
  return coupon;
}

export async function createCoupon(actor: PlatformActor, input: CouponInput) {
  await assertPlansExist(input.planIds);
  const existing = await prisma.coupon.findUnique({ where: { code: input.code }, select: { id: true } });
  if (existing) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `Coupon code "${input.code}" is already used.`);

  const coupon = await prisma.coupon.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      discountType: input.discountType,
      discountValue: input.discountValue,
      currencyCode: input.currencyCode,
      ...toDates(input),
      maxRedemptions: input.maxRedemptions,
      maxRedemptionsPerCompany: input.maxRedemptionsPerCompany,
      billingCycles: input.billingCycles,
      isActive: input.isActive,
      createdByPlatformUserId: actor.platformUserId,
      plans: { create: [...new Set(input.planIds)].map((planId) => ({ planId })) },
    },
  });
  return coupon;
}

/**
 * Edits a coupon. Once it has been used, the discount itself (type/value)
 * is frozen so past redemptions keep meaning what they meant; dates, limits,
 * plans and on/off can still change.
 */
export async function updateCoupon(actor: PlatformActor, id: string, input: CouponInput) {
  const existing = await prisma.coupon.findUnique({
    where: { id },
    include: { _count: { select: { redemptions: true } } },
  });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Coupon not found.");
  if (existing.code !== input.code) {
    const clash = await prisma.coupon.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `Coupon code "${input.code}" is already used.`);
  }
  if (
    existing._count.redemptions > 0 &&
    (existing.discountType !== input.discountType ||
      Number(existing.discountValue) !== input.discountValue ||
      existing.code !== input.code)
  ) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This coupon has already been used, so its code and discount can't change. Create a new coupon instead."
    );
  }
  await assertPlansExist(input.planIds);

  const saved = await prisma.$transaction(async (tx) => {
    await tx.couponPlan.deleteMany({ where: { couponId: id } });
    return tx.coupon.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue,
        currencyCode: input.currencyCode,
        ...toDates(input),
        maxRedemptions: input.maxRedemptions,
        maxRedemptionsPerCompany: input.maxRedemptionsPerCompany,
        billingCycles: input.billingCycles,
        isActive: input.isActive,
        plans: { create: [...new Set(input.planIds)].map((planId) => ({ planId })) },
      },
    });
  });
  return saved;
}

export type CouponUsage = "PAYMENT" | "TRIAL";

export interface CouponUseContext {
  companyId: string | null; // null when the company is being created right now
  planId: string;
  billingCycle?: SubscriptionBillingCycle;
  usage: CouponUsage;
}

type CouponWithPlans = Coupon & { plans: { planId: string }[] };

/** The checks that don't need the database (pure; unit-tested). Returns a reason, or null if usable. */
export function couponRejectionReason(coupon: CouponWithPlans, ctx: CouponUseContext, now: Date): string | null {
  if (!coupon.isActive) return "This coupon is no longer active.";
  if (coupon.validFrom && coupon.validFrom > now) return "This coupon isn't valid yet.";
  if (coupon.validUntil && coupon.validUntil < now) return "This coupon has expired.";
  if (ctx.usage === "TRIAL" && coupon.discountType !== "TRIAL_EXTENSION") {
    return "Only a 'longer free trial' coupon can be used when creating a company.";
  }
  if (ctx.usage === "PAYMENT" && coupon.discountType === "TRIAL_EXTENSION") {
    return "A 'longer free trial' coupon can only be used when creating a company.";
  }
  if (coupon.plans.length > 0 && !coupon.plans.some((p) => p.planId === ctx.planId)) {
    return "This coupon doesn't apply to the selected plan.";
  }
  if (ctx.usage === "PAYMENT" && coupon.billingCycles.length > 0 && ctx.billingCycle && !coupon.billingCycles.includes(ctx.billingCycle)) {
    return `This coupon only applies to ${coupon.billingCycles.map((c) => c.toLowerCase()).join(" / ")} billing.`;
  }
  return null;
}

export interface CouponEffect {
  listAmount: number;
  discountAmount: number;
  finalAmount: number;
  freeMonths: number;
  trialDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the coupon does to a payment of `listAmount` (or to a trial). Pure. */
export function computeCouponEffect(coupon: Pick<Coupon, "discountType" | "discountValue">, listAmount: number): CouponEffect {
  const value = Number(coupon.discountValue);
  let discountAmount = 0;
  let freeMonths = 0;
  let trialDays = 0;
  switch (coupon.discountType) {
    case "PERCENT":
      discountAmount = round2((listAmount * Math.min(value, 100)) / 100);
      break;
    case "FIXED_AMOUNT":
      discountAmount = round2(Math.min(value, listAmount));
      break;
    case "FREE_MONTHS":
      freeMonths = Math.round(value);
      break;
    case "TRIAL_EXTENSION":
      trialDays = Math.round(value);
      break;
  }
  return {
    listAmount: round2(listAmount),
    discountAmount,
    finalAmount: round2(Math.max(0, listAmount - discountAmount)),
    freeMonths,
    trialDays,
  };
}

async function findCouponByCode(client: Prisma.TransactionClient | typeof prisma, code: string) {
  return client.coupon.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { plans: { select: { planId: true } } },
  });
}

/** Redemption-count limits. Must run with the coupon row locked (inside the use transaction). */
async function assertRedemptionLimits(client: Prisma.TransactionClient | typeof prisma, coupon: Coupon, companyId: string | null) {
  if (coupon.maxRedemptions !== null) {
    const used = await client.couponRedemption.count({ where: { couponId: coupon.id } });
    if (used >= coupon.maxRedemptions) throw new BusinessRuleError("COUPON_INVALID", "This coupon has been fully used.");
  }
  if (companyId) {
    const usedHere = await client.couponRedemption.count({ where: { couponId: coupon.id, companyId } });
    if (usedHere >= coupon.maxRedemptionsPerCompany) {
      throw new BusinessRuleError("COUPON_INVALID", "This company has already used this coupon.");
    }
  }
}

/** Read-only check used by the payment / company form before saving. */
export async function previewCoupon(input: CouponPreviewInput, now = new Date()) {
  const coupon = await findCouponByCode(prisma, input.code);
  if (!coupon) throw new BusinessRuleError("COUPON_INVALID", "No coupon with that code.");
  const reason = couponRejectionReason(
    coupon,
    { companyId: input.companyId, planId: input.planId, billingCycle: input.billingCycle, usage: "PAYMENT" },
    now
  );
  if (reason) throw new BusinessRuleError("COUPON_INVALID", reason);
  await assertRedemptionLimits(prisma, coupon, input.companyId);
  return { coupon: { id: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discountType }, effect: computeCouponEffect(coupon, input.amount) };
}

/** Trial-coupon preview for the New Company form (company doesn't exist yet). */
export async function previewTrialCoupon(code: string, planId: string, now = new Date()) {
  const coupon = await findCouponByCode(prisma, code);
  if (!coupon) throw new BusinessRuleError("COUPON_INVALID", "No coupon with that code.");
  const reason = couponRejectionReason(coupon, { companyId: null, planId, usage: "TRIAL" }, now);
  if (reason) throw new BusinessRuleError("COUPON_INVALID", reason);
  await assertRedemptionLimits(prisma, coupon, null);
  return { coupon: { id: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discountType }, effect: computeCouponEffect(coupon, 0) };
}

/**
 * Locks, re-validates and returns the coupon + its effect inside the caller's
 * transaction. The caller then saves its payment / subscription and calls
 * `recordRedemptionInTx`.
 */
export async function claimCouponInTx(
  tx: Prisma.TransactionClient,
  code: string,
  ctx: CouponUseContext,
  listAmount: number,
  now = new Date()
) {
  const found = await findCouponByCode(tx, code);
  if (!found) throw new BusinessRuleError("COUPON_INVALID", "No coupon with that code.");
  await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${found.id}::uuid FOR UPDATE`;
  const coupon = (await findCouponByCode(tx, code))!;
  const reason = couponRejectionReason(coupon, ctx, now);
  if (reason) throw new BusinessRuleError("COUPON_INVALID", reason);
  await assertRedemptionLimits(tx, coupon, ctx.companyId);
  return { coupon, effect: computeCouponEffect(coupon, listAmount) };
}

export async function recordRedemptionInTx(
  tx: Prisma.TransactionClient,
  data: {
    couponId: string;
    companyId: string;
    paymentId?: string | null;
    effect: CouponEffect;
    platformUserId: string;
  }
) {
  return tx.couponRedemption.create({
    data: {
      couponId: data.couponId,
      companyId: data.companyId,
      paymentId: data.paymentId ?? null,
      discountAmount: data.effect.discountAmount,
      freeMonths: data.effect.freeMonths,
      trialDays: data.effect.trialDays,
      redeemedByPlatformUserId: data.platformUserId,
    },
  });
}

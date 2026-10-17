import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  couponFindUnique: vi.fn(),
  couponCreate: vi.fn(),
  couponUpdate: vi.fn(),
  planCount: vi.fn(),
  redemptionCount: vi.fn(),
  redemptionCreate: vi.fn(),
  couponPlanDeleteMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const client = {
    coupon: { findUnique: m.couponFindUnique, create: m.couponCreate, update: m.couponUpdate },
    couponPlan: { deleteMany: m.couponPlanDeleteMany },
    couponRedemption: { count: m.redemptionCount, create: m.redemptionCreate },
    subscriptionPlan: { count: m.planCount },
    $queryRaw: m.queryRaw,
  };
  return { prisma: { ...client, $transaction: async (fn: (t: typeof client) => unknown) => fn(client) } };
});

const svc = await import("./coupon.service");
const now = new Date("2026-10-14T10:00:00.000Z");

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    id: "cp-1",
    code: "LAUNCH20",
    name: "Launch",
    description: null,
    discountType: "PERCENT",
    discountValue: new Prisma.Decimal(20),
    currencyCode: "INR",
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    maxRedemptionsPerCompany: 1,
    billingCycles: [],
    isActive: true,
    createdByPlatformUserId: null,
    createdAt: now,
    updatedAt: now,
    plans: [],
    ...overrides,
  } as Parameters<typeof svc.couponRejectionReason>[0];
}

const paymentCtx = { companyId: "co-1", planId: "plan-1", billingCycle: "MONTHLY" as const, usage: "PAYMENT" as const };

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.redemptionCount.mockResolvedValue(0);
});

describe("computeCouponEffect", () => {
  it("percentage off, rounded to paise", () => {
    expect(svc.computeCouponEffect({ discountType: "PERCENT", discountValue: new Prisma.Decimal(15) }, 999.99)).toEqual({
      listAmount: 999.99,
      discountAmount: 150,
      finalAmount: 849.99,
      freeMonths: 0,
      trialDays: 0,
    });
  });

  it("a fixed amount never makes the payment negative", () => {
    const e = svc.computeCouponEffect({ discountType: "FIXED_AMOUNT", discountValue: new Prisma.Decimal(8000) }, 5000);
    expect(e).toMatchObject({ discountAmount: 5000, finalAmount: 0 });
  });

  it("free months and trial days don't touch the amount", () => {
    expect(svc.computeCouponEffect({ discountType: "FREE_MONTHS", discountValue: new Prisma.Decimal(2) }, 5000)).toMatchObject({
      discountAmount: 0,
      finalAmount: 5000,
      freeMonths: 2,
    });
    expect(svc.computeCouponEffect({ discountType: "TRIAL_EXTENSION", discountValue: new Prisma.Decimal(30) }, 0)).toMatchObject({
      trialDays: 30,
    });
  });
});

describe("couponRejectionReason", () => {
  it("accepts a valid coupon", () => {
    expect(svc.couponRejectionReason(coupon(), paymentCtx, now)).toBeNull();
  });

  it("rejects inactive, not-yet-valid and expired coupons", () => {
    expect(svc.couponRejectionReason(coupon({ isActive: false }), paymentCtx, now)).toMatch(/no longer active/);
    expect(svc.couponRejectionReason(coupon({ validFrom: new Date("2026-11-01") }), paymentCtx, now)).toMatch(/isn't valid yet/);
    expect(svc.couponRejectionReason(coupon({ validUntil: new Date("2026-10-01") }), paymentCtx, now)).toMatch(/expired/);
  });

  it("checks plan and billing-cycle restrictions", () => {
    expect(svc.couponRejectionReason(coupon({ plans: [{ planId: "other" }] }), paymentCtx, now)).toMatch(/selected plan/);
    expect(svc.couponRejectionReason(coupon({ plans: [{ planId: "plan-1" }] }), paymentCtx, now)).toBeNull();
    expect(svc.couponRejectionReason(coupon({ billingCycles: ["ANNUAL"] }), paymentCtx, now)).toMatch(/annual/);
  });

  it("keeps trial coupons and payment coupons apart", () => {
    const trial = coupon({ discountType: "TRIAL_EXTENSION" });
    expect(svc.couponRejectionReason(trial, paymentCtx, now)).toMatch(/creating a company/);
    expect(svc.couponRejectionReason(coupon(), { companyId: null, planId: "plan-1", usage: "TRIAL" }, now)).toMatch(/longer free trial/);
    expect(svc.couponRejectionReason(trial, { companyId: null, planId: "plan-1", usage: "TRIAL" }, now)).toBeNull();
  });
});

describe("claimCouponInTx", () => {
  const tx = { coupon: { findUnique: m.couponFindUnique }, couponRedemption: { count: m.redemptionCount }, $queryRaw: m.queryRaw };

  it("locks the coupon row and returns the effect", async () => {
    m.couponFindUnique.mockResolvedValue(coupon());
    const result = await svc.claimCouponInTx(tx as never, "launch20", paymentCtx, 5000, now);
    expect(m.queryRaw).toHaveBeenCalled();
    expect(m.couponFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: "LAUNCH20" } }));
    expect(result.effect).toMatchObject({ discountAmount: 1000, finalAmount: 4000 });
  });

  it("rejects an unknown code", async () => {
    m.couponFindUnique.mockResolvedValue(null);
    await expect(svc.claimCouponInTx(tx as never, "NOPE", paymentCtx, 5000, now)).rejects.toMatchObject({ code: "COUPON_INVALID" });
  });

  it("enforces the total and per-company limits", async () => {
    m.couponFindUnique.mockResolvedValue(coupon({ maxRedemptions: 3 }));
    m.redemptionCount.mockResolvedValueOnce(3);
    await expect(svc.claimCouponInTx(tx as never, "LAUNCH20", paymentCtx, 5000, now)).rejects.toThrow(/fully used/);

    m.couponFindUnique.mockResolvedValue(coupon());
    m.redemptionCount.mockReset().mockResolvedValueOnce(1);
    await expect(svc.claimCouponInTx(tx as never, "LAUNCH20", paymentCtx, 5000, now)).rejects.toThrow(/already used this coupon/);
  });
});

describe("updateCoupon", () => {
  const input = {
    code: "LAUNCH20",
    name: "Launch",
    description: null,
    discountType: "PERCENT" as const,
    discountValue: 25,
    currencyCode: "INR",
    validFrom: null,
    validUntil: null,
    maxRedemptions: null,
    maxRedemptionsPerCompany: 1,
    billingCycles: [],
    planIds: [],
    isActive: true,
  };

  it("freezes the discount once the coupon has been used", async () => {
    m.couponFindUnique.mockResolvedValue({ ...coupon(), _count: { redemptions: 2 } });
    await expect(svc.updateCoupon({ platformUserId: "pu-1" }, "cp-1", input)).rejects.toThrow(/already been used/);
    expect(m.couponUpdate).not.toHaveBeenCalled();
  });

  it("still allows deactivating a used coupon", async () => {
    m.couponFindUnique.mockResolvedValue({ ...coupon(), _count: { redemptions: 2 } });
    m.couponUpdate.mockResolvedValue({ id: "cp-1" });
    await svc.updateCoupon({ platformUserId: "pu-1" }, "cp-1", { ...input, discountValue: 20, isActive: false });
    expect(m.couponUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });
});

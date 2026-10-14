import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  companyFindUnique: vi.fn(),
  planFindUnique: vi.fn(),
  subFindUnique: vi.fn(),
  userCount: vi.fn(),
  txSubFindUnique: vi.fn(),
  txSubUpdate: vi.fn(),
  txSubCreate: vi.fn(),
  txPaymentCreate: vi.fn(),
  queryRaw: vi.fn(),
  audit: vi.fn(),
  invalidateEnt: vi.fn(),
  invalidatePerm: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const tx = {
    $queryRaw: m.queryRaw,
    companySubscription: { findUnique: m.txSubFindUnique, update: m.txSubUpdate, create: m.txSubCreate },
    subscriptionPayment: { create: m.txPaymentCreate },
  };
  return {
    prisma: {
      company: { findUnique: m.companyFindUnique },
      subscriptionPlan: { findUnique: m.planFindUnique },
      companySubscription: { findUnique: m.subFindUnique },
      user: { count: m.userCount },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: m.audit }));
vi.mock("@/core/entitlements/EntitlementService", () => ({ EntitlementService: { invalidate: m.invalidateEnt } }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { invalidate: m.invalidatePerm } }));
vi.mock("./subscription-plan.service", () => ({ resolveTrialPlan: vi.fn() }));

const svc = await import("./company-subscription.service");
const actor = { platformUserId: "pu-1" };
const now = new Date("2026-10-13T10:00:00.000Z");
const plan = { id: "plan-1", name: "Standard", isActive: true, currencyCode: "INR" };
const payment = {
  planId: "plan-1",
  billingCycle: "MONTHLY" as const,
  periods: 1,
  amount: 5000,
  paidAt: "2026-10-12",
  method: "BANK_TRANSFER" as const,
  reference: "UTR123",
  notes: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.values(m).forEach((fn) => fn.mockReset());
  m.companyFindUnique.mockResolvedValue({ id: "co-1" });
  m.planFindUnique.mockResolvedValue(plan);
  m.txSubUpdate.mockImplementation(async ({ data }) => ({ id: "sub-1", ...data }));
  m.txPaymentCreate.mockImplementation(async ({ data }) => ({ id: "pay-1", ...data }));
});
afterEach(() => vi.useRealTimers());

describe("recordSubscriptionPayment", () => {
  it("extends from the current end when paying early, and ends the trial", async () => {
    const currentEnd = new Date("2026-10-20T00:00:00.000Z");
    m.txSubFindUnique.mockResolvedValue({ id: "sub-1", planId: "plan-1", isTrial: true, currentPeriodEndsAt: currentEnd });
    const { payment: saved } = await svc.recordSubscriptionPayment(actor, "co-1", payment);
    expect(saved.periodStart).toEqual(currentEnd);
    expect(saved.periodEnd.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(m.txSubUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isTrial: false, currentPeriodEndsAt: saved.periodEnd, lastNotifiedKey: null }) })
    );
    expect(m.queryRaw).toHaveBeenCalled(); // row lock before reading
    expect(m.invalidateEnt).toHaveBeenCalledWith("co-1");
  });

  it("starts from today when the subscription already lapsed, never back-dating", async () => {
    m.txSubFindUnique.mockResolvedValue({ id: "sub-1", planId: "plan-1", isTrial: false, currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z") });
    const { payment: saved } = await svc.recordSubscriptionPayment(actor, "co-1", { ...payment, billingCycle: "ANNUAL", periods: 2 });
    expect(saved.periodStart).toEqual(now);
    expect(saved.periodEnd.toISOString()).toBe("2028-10-13T10:00:00.000Z");
  });

  it("refuses an inactive plan", async () => {
    m.planFindUnique.mockResolvedValue({ ...plan, isActive: false });
    await expect(svc.recordSubscriptionPayment(actor, "co-1", payment)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(m.txPaymentCreate).not.toHaveBeenCalled();
  });
});

describe("adjustSubscriptionPeriod", () => {
  it("can remove the expiry (complimentary) and clears the trial flag", async () => {
    m.txSubFindUnique.mockResolvedValue({ id: "sub-1", isTrial: true, currentPeriodEndsAt: now });
    await svc.adjustSubscriptionPeriod(actor, "co-1", { noExpiry: true, reason: "Partner account" });
    expect(m.txSubUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentPeriodEndsAt: null, isTrial: false }) })
    );
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ newValues: expect.objectContaining({ reason: "Partner account" }) }),
      expect.anything()
    );
  });

  it("refuses a company with no subscription yet", async () => {
    m.txSubFindUnique.mockResolvedValue(null);
    await expect(
      svc.adjustSubscriptionPeriod(actor, "co-1", { noExpiry: false, periodEndsAt: "2026-12-31", reason: "Extend trial" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("assertUserLimitAllows", () => {
  it("passes with no limit", async () => {
    m.subFindUnique.mockResolvedValue({ plan: { name: "Standard", maxUsers: null } });
    await expect(svc.assertUserLimitAllows("co-1")).resolves.toBeUndefined();
    expect(m.userCount).not.toHaveBeenCalled();
  });

  it("refuses one user over the plan limit", async () => {
    m.subFindUnique.mockResolvedValue({ plan: { name: "Starter", maxUsers: 5 } });
    m.userCount.mockResolvedValue(5);
    await expect(svc.assertUserLimitAllows("co-1")).rejects.toMatchObject({ code: "SUBSCRIPTION_LIMIT_REACHED" });
    m.userCount.mockResolvedValue(4);
    await expect(svc.assertUserLimitAllows("co-1")).resolves.toBeUndefined();
  });
});

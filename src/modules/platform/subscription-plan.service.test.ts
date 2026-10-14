import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  txUpdateMany: vi.fn(),
  txCreate: vi.fn(),
  txUpdate: vi.fn(),
  txModulesDelete: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const tx = {
    subscriptionPlan: { updateMany: m.txUpdateMany, create: m.txCreate, update: m.txUpdate },
    subscriptionPlanModule: { deleteMany: m.txModulesDelete },
  };
  return {
    prisma: {
      subscriptionPlan: { findUnique: m.findUnique, findFirst: m.findFirst },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/core/entitlements/EntitlementService", () => ({ EntitlementService: { invalidate: m.invalidate } }));

const svc = await import("./subscription-plan.service");
const { subscriptionPlanSchema } = await import("./subscription.schema");
const actor = { platformUserId: "pu-1" };

beforeEach(() => Object.values(m).forEach((fn) => fn.mockReset()));

const input = (over: Record<string, unknown> = {}) =>
  subscriptionPlanSchema.parse({ code: "pro", name: "Pro", modules: ["CRM", "CRM", "HRMS"], ...over });

describe("subscription plans", () => {
  it("normalises input: upper-case code, empty prices to null", () => {
    const parsed = input({ monthlyPrice: "", annualPrice: "12000", maxUsers: "" });
    expect(parsed).toMatchObject({ code: "PRO", monthlyPrice: null, annualPrice: 12000, maxUsers: null, trialDays: 14 });
  });

  it("makes a new default trial plan the only default, with de-duplicated modules", async () => {
    m.findUnique.mockResolvedValue(null);
    m.txCreate.mockResolvedValue({ id: "p1" });
    await svc.createSubscriptionPlan(actor, input({ isDefaultTrialPlan: true }));
    expect(m.txUpdateMany).toHaveBeenCalledWith({ where: { isDefaultTrialPlan: true }, data: { isDefaultTrialPlan: false } });
    const data = m.txCreate.mock.calls[0][0].data;
    expect(data.modules.create).toEqual([{ packageKey: "CRM" }, { packageKey: "HRMS" }]);
  });

  it("refuses a duplicate code and an inactive default", async () => {
    m.findUnique.mockResolvedValue({ id: "other" });
    await expect(svc.createSubscriptionPlan(actor, input())).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    await expect(svc.createSubscriptionPlan(actor, input({ isDefaultTrialPlan: true, isActive: false }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("clears every company's entitlement cache when a plan changes", async () => {
    m.findUnique.mockResolvedValueOnce({ id: "p1", isDefaultTrialPlan: false }).mockResolvedValueOnce(null);
    m.txUpdate.mockResolvedValue({ id: "p1" });
    await svc.updateSubscriptionPlan(actor, "p1", input());
    expect(m.txModulesDelete).toHaveBeenCalledWith({ where: { planId: "p1" } });
    expect(m.invalidate).toHaveBeenCalledWith();
  });

  it("falls back to any active plan for a trial and errors when there is none", async () => {
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "p2" });
    await expect(svc.resolveTrialPlan()).resolves.toEqual({ id: "p2" });
    m.findFirst.mockResolvedValue(null);
    await expect(svc.resolveTrialPlan()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

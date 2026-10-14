import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  subFindMany: vi.fn(),
  userFindMany: vi.fn(),
  updateMany: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const tx = { companySubscription: { updateMany: m.updateMany } };
  return {
    prisma: {
      companySubscription: { findMany: m.subFindMany },
      user: { findMany: m.userFindMany },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: m.notify }));

const { lifecycleStage, shouldNotify, processSubscriptionLifecycle } = await import("./subscription-lifecycle.service");

const now = new Date("2026-10-13T10:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

beforeEach(() => Object.values(m).forEach((fn) => fn.mockReset()));

describe("lifecycleStage", () => {
  it("is null while comfortably active or with no expiry", () => {
    expect(lifecycleStage({ isTrial: false, currentPeriodEndsAt: at(10) }, now)).toBeNull();
    expect(lifecycleStage({ isTrial: false, currentPeriodEndsAt: null }, now)).toBeNull();
  });

  it("warns within 3 days of the end, then grace, then expired", () => {
    expect(lifecycleStage({ isTrial: true, currentPeriodEndsAt: at(2) }, now)).toBe("ENDING_SOON");
    expect(lifecycleStage({ isTrial: true, currentPeriodEndsAt: at(-1) }, now)).toBe("GRACE");
    expect(lifecycleStage({ isTrial: true, currentPeriodEndsAt: at(-9) }, now)).toBe("EXPIRED");
  });
});

describe("shouldNotify", () => {
  const end = at(-1);
  it("sends once per stage per period and only forward", () => {
    expect(shouldNotify(null, "GRACE", end)).toBe(true);
    expect(shouldNotify(`GRACE|${end.toISOString()}`, "GRACE", end)).toBe(false);
    expect(shouldNotify(`EXPIRED|${end.toISOString()}`, "GRACE", end)).toBe(false);
    expect(shouldNotify(`ENDING_SOON|${end.toISOString()}`, "GRACE", end)).toBe(true);
  });

  it("starts over when the period end changed (renewed, then lapsed again)", () => {
    expect(shouldNotify(`EXPIRED|${at(-40).toISOString()}`, "ENDING_SOON", at(2))).toBe(true);
  });
});

describe("processSubscriptionLifecycle", () => {
  it("notifies every Super Admin once and claims the stage", async () => {
    const end = at(-1);
    m.subFindMany.mockResolvedValue([{ id: "s1", companyId: "co-1", isTrial: false, currentPeriodEndsAt: end, lastNotifiedKey: null }]);
    m.userFindMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    m.updateMany.mockResolvedValue({ count: 1 });

    const result = await processSubscriptionLifecycle(now);

    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", lastNotifiedKey: null, currentPeriodEndsAt: end },
      data: { lastNotifiedKey: `GRACE|${end.toISOString()}` },
    });
    expect(m.notify).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 1, sent: 2 });
  });

  it("sends nothing when another worker already claimed it", async () => {
    m.subFindMany.mockResolvedValue([{ id: "s1", companyId: "co-1", isTrial: false, currentPeriodEndsAt: at(-1), lastNotifiedKey: null }]);
    m.userFindMany.mockResolvedValue([{ id: "u1" }]);
    m.updateMany.mockResolvedValue({ count: 0 });
    expect(await processSubscriptionLifecycle(now)).toEqual({ checked: 1, sent: 0 });
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("skips a stage already notified for this period", async () => {
    const end = at(-1);
    m.subFindMany.mockResolvedValue([
      { id: "s1", companyId: "co-1", isTrial: false, currentPeriodEndsAt: end, lastNotifiedKey: `GRACE|${end.toISOString()}` },
    ]);
    await processSubscriptionLifecycle(now);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});

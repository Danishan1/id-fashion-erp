import { describe, expect, it } from "vitest";
import { addMonths, computeSubscriptionStatus, isActionAllowedWhileReadOnly } from "./subscription-state";

const now = new Date("2026-10-13T10:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

describe("computeSubscriptionStatus", () => {
  it("treats no subscription and no end date as full access", () => {
    expect(computeSubscriptionStatus(null, now)).toMatchObject({ state: "NONE", readOnly: false });
    expect(computeSubscriptionStatus({ isTrial: false, currentPeriodEndsAt: null }, now)).toMatchObject({
      state: "UNLIMITED",
      readOnly: false,
    });
  });

  it("is TRIAL / ACTIVE with full access before the period ends", () => {
    const end = new Date(now.getTime() + 5 * day);
    expect(computeSubscriptionStatus({ isTrial: true, currentPeriodEndsAt: end }, now)).toMatchObject({
      state: "TRIAL",
      readOnly: false,
      daysLeft: 5,
    });
    expect(computeSubscriptionStatus({ isTrial: false, currentPeriodEndsAt: end }, now).state).toBe("ACTIVE");
  });

  it("is a read-only GRACE period for 7 days after the end", () => {
    const end = new Date(now.getTime() - 2 * day);
    const status = computeSubscriptionStatus({ isTrial: true, currentPeriodEndsAt: end }, now);
    expect(status).toMatchObject({ state: "GRACE", readOnly: true, daysLeft: 5 });
    expect(status.graceEndsAt?.getTime()).toBe(end.getTime() + 7 * day);
  });

  it("is a read-only EXPIRED archive after the grace period (DEC-01)", () => {
    const end = new Date(now.getTime() - 8 * day);
    expect(computeSubscriptionStatus({ isTrial: false, currentPeriodEndsAt: end }, now)).toMatchObject({
      state: "EXPIRED",
      readOnly: true,
    });
  });

  it("switches exactly at the boundaries", () => {
    expect(computeSubscriptionStatus({ isTrial: false, currentPeriodEndsAt: now }, now).state).toBe("GRACE");
    const end = new Date(now.getTime() - 7 * day);
    expect(computeSubscriptionStatus({ isTrial: false, currentPeriodEndsAt: end }, now).state).toBe("EXPIRED");
  });
});

describe("read-only actions", () => {
  it("allows only view, view_all, print and export", () => {
    for (const a of ["view", "view_all", "print", "export"] as const) expect(isActionAllowedWhileReadOnly(a)).toBe(true);
    for (const a of ["create", "edit", "delete", "approve", "post", "cancel", "scan"] as const) {
      expect(isActionAllowedWhileReadOnly(a)).toBe(false);
    }
  });
});

describe("addMonths", () => {
  it("clamps to the end of a shorter month", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(new Date("2028-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("adds a year as 12 months", () => {
    expect(addMonths(new Date("2026-10-13T10:00:00.000Z"), 12).toISOString()).toBe("2027-10-13T10:00:00.000Z");
  });
});

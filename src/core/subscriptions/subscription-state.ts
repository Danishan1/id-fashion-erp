import type { Action } from "@/config/rbac";

/**
 * A company's subscription access state (Platform SaaS Phase 4, PLAT-024/025).
 * Always DERIVED from the subscription's period end at read time — never
 * stored — so it can't drift from the real dates. Client-safe (no Prisma).
 *
 *   TRIAL / ACTIVE  — before the period ends: full access.
 *   GRACE           — the 7 days after it ends: read-only.
 *   EXPIRED         — after the grace period: read-only archive (DEC-01).
 *   UNLIMITED       — no end date (complimentary / pre-Phase-4 customers).
 *   NONE            — no subscription row at all: treated as unrestricted.
 */
export const GRACE_PERIOD_DAYS = 7;

/** How long before the period end the "renew soon" notice is sent. */
export const ENDING_SOON_DAYS = 3;

export type SubscriptionAccessState = "TRIAL" | "ACTIVE" | "GRACE" | "EXPIRED" | "UNLIMITED" | "NONE";

/** What a company may still do while read-only (grace + expired archive). */
export const READ_ONLY_ACTIONS: readonly Action[] = ["view", "view_all", "print", "export"];

export interface SubscriptionDates {
  isTrial: boolean;
  currentPeriodEndsAt: Date | string | null;
}

export interface SubscriptionStatus {
  state: SubscriptionAccessState;
  readOnly: boolean;
  periodEndsAt: Date | null;
  graceEndsAt: Date | null;
  /** Whole days until the next change (period end while active, grace end while in grace); null otherwise. */
  daysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Adds calendar months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

function daysUntil(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
}

export function computeSubscriptionStatus(sub: SubscriptionDates | null | undefined, now: Date = new Date()): SubscriptionStatus {
  if (!sub) return { state: "NONE", readOnly: false, periodEndsAt: null, graceEndsAt: null, daysLeft: null };
  if (!sub.currentPeriodEndsAt) {
    return { state: "UNLIMITED", readOnly: false, periodEndsAt: null, graceEndsAt: null, daysLeft: null };
  }
  const periodEndsAt = new Date(sub.currentPeriodEndsAt);
  const graceEndsAt = addDays(periodEndsAt, GRACE_PERIOD_DAYS);
  if (now < periodEndsAt) {
    return {
      state: sub.isTrial ? "TRIAL" : "ACTIVE",
      readOnly: false,
      periodEndsAt,
      graceEndsAt,
      daysLeft: daysUntil(now, periodEndsAt),
    };
  }
  if (now < graceEndsAt) {
    return { state: "GRACE", readOnly: true, periodEndsAt, graceEndsAt, daysLeft: daysUntil(now, graceEndsAt) };
  }
  return { state: "EXPIRED", readOnly: true, periodEndsAt, graceEndsAt, daysLeft: null };
}

export function isActionAllowedWhileReadOnly(action: Action): boolean {
  return READ_ONLY_ACTIONS.includes(action);
}

export const SUBSCRIPTION_STATE_LABELS: Record<SubscriptionAccessState, string> = {
  TRIAL: "Trial",
  ACTIVE: "Active",
  GRACE: "Grace period (read-only)",
  EXPIRED: "Expired (read-only)",
  UNLIMITED: "Active (no expiry)",
  NONE: "No subscription",
};

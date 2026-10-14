import {
  ENDING_SOON_DAYS,
  type SubscriptionStatus,
} from "@/core/subscriptions/subscription-state";

/** Days of trial left at which the trial banner starts showing. */
const TRIAL_NOTICE_DAYS = 7;

function fmt(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function days(n: number) {
  return n === 1 ? "1 day" : `${n} days`;
}

/**
 * Platform SaaS Phase 4 (PLAT-024/025): tells every user of the company when
 * the trial/subscription is ending and when the ERP has become read-only.
 * Server-rendered from the derived subscription state; renders nothing while
 * the subscription is comfortably active.
 */
export function SubscriptionBanner({ status }: { status: SubscriptionStatus }) {
  const { state, periodEndsAt, graceEndsAt, daysLeft } = status;

  if (state === "GRACE" && periodEndsAt && graceEndsAt) {
    return (
      <div className="bg-red-600 px-4 py-2 text-sm text-white">
        <span className="font-semibold">Subscription ended on {fmt(periodEndsAt)} — the ERP is read-only.</span> You can
        view, print and export, but not add or change anything. {days(daysLeft ?? 0)} left before your account becomes a
        read-only archive ({fmt(graceEndsAt)}). Ask your administrator to renew.
      </div>
    );
  }
  if (state === "EXPIRED") {
    return (
      <div className="bg-red-700 px-4 py-2 text-sm text-white">
        <span className="font-semibold">This account is a read-only archive.</span> Your subscription has expired. You can
        still view and export your records. Ask your administrator to contact the platform team to renew.
      </div>
    );
  }
  if (state === "TRIAL" && periodEndsAt && daysLeft !== null && daysLeft <= TRIAL_NOTICE_DAYS) {
    return (
      <div className="bg-amber-500 px-4 py-2 text-sm text-amber-950">
        <span className="font-semibold">Your free trial ends in {days(daysLeft)}</span> ({fmt(periodEndsAt)}). Contact the
        platform team to subscribe and keep full access.
      </div>
    );
  }
  if (state === "ACTIVE" && periodEndsAt && daysLeft !== null && daysLeft <= ENDING_SOON_DAYS) {
    return (
      <div className="bg-amber-500 px-4 py-2 text-sm text-amber-950">
        <span className="font-semibold">Your subscription ends in {days(daysLeft)}</span> ({fmt(periodEndsAt)}). Renew to
        avoid the ERP becoming read-only.
      </div>
    );
  }
  return null;
}

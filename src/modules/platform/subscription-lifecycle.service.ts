import { prisma } from "@/core/db/client";
import { createNotification } from "@/core/notifications/NotificationService";
import { ENDING_SOON_DAYS, addDays, computeSubscriptionStatus } from "@/core/subscriptions/subscription-state";

/**
 * Subscription lifecycle notices (Platform SaaS Phase 4, PLAT-023), run hourly
 * by the worker. Nothing here changes access — read-only mode is derived from
 * the dates on every request. This only tells the company's Super Admins, in
 * the app, when their trial/subscription is about to end, has entered the
 * 7-day grace period, and has become a read-only archive.
 *
 * Idempotent: `last_notified_key` = "<STAGE>|<period end ISO>". A notice is
 * sent only when the stage advances for the same period, and the key is
 * claimed with a conditional update in the same transaction as the
 * notifications, so two workers can never both send it.
 */

export type LifecycleStage = "ENDING_SOON" | "GRACE" | "EXPIRED";
const STAGE_RANK: Record<LifecycleStage, number> = { ENDING_SOON: 1, GRACE: 2, EXPIRED: 3 };

export function lifecycleStage(sub: { isTrial: boolean; currentPeriodEndsAt: Date | null }, now: Date): LifecycleStage | null {
  const status = computeSubscriptionStatus(sub, now);
  if (status.state === "GRACE") return "GRACE";
  if (status.state === "EXPIRED") return "EXPIRED";
  if ((status.state === "TRIAL" || status.state === "ACTIVE") && status.periodEndsAt) {
    if (status.periodEndsAt <= addDays(now, ENDING_SOON_DAYS)) return "ENDING_SOON";
  }
  return null;
}

export function shouldNotify(lastKey: string | null, stage: LifecycleStage, periodEndsAt: Date): boolean {
  if (!lastKey) return true;
  const [lastStage, lastPeriod] = lastKey.split("|");
  if (lastPeriod !== periodEndsAt.toISOString()) return true;
  return STAGE_RANK[stage] > (STAGE_RANK[lastStage as LifecycleStage] ?? 0);
}

function fmt(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function message(stage: LifecycleStage, isTrial: boolean, periodEndsAt: Date): { title: string; body: string } {
  const what = isTrial ? "free trial" : "subscription";
  const graceEnd = addDays(periodEndsAt, 7);
  switch (stage) {
    case "ENDING_SOON":
      return {
        title: `Your ${what} ends on ${fmt(periodEndsAt)}`,
        body: `Renew before ${fmt(periodEndsAt)} to keep full access. After that the ERP becomes read-only. Contact the platform team to renew.`,
      };
    case "GRACE":
      return {
        title: `Your ${what} has ended — read-only until renewed`,
        body: `You can still view, print and export your data, but nothing can be added or changed. Renew before ${fmt(graceEnd)} to avoid the archive state.`,
      };
    case "EXPIRED":
      return {
        title: "Your account is now a read-only archive",
        body: "The 7-day grace period has passed. You can still sign in to view and export your records. Contact the platform team to renew and resume work.",
      };
  }
}

export async function processSubscriptionLifecycle(now: Date = new Date()) {
  const subscriptions = await prisma.companySubscription.findMany({
    where: { currentPeriodEndsAt: { not: null }, company: { isActive: true } },
    select: { id: true, companyId: true, isTrial: true, currentPeriodEndsAt: true, lastNotifiedKey: true },
  });

  let sent = 0;
  for (const sub of subscriptions) {
    const periodEndsAt = sub.currentPeriodEndsAt!;
    const stage = lifecycleStage(sub, now);
    if (!stage || !shouldNotify(sub.lastNotifiedKey, stage, periodEndsAt)) continue;

    const recipients = await prisma.user.findMany({
      where: {
        companyId: sub.companyId,
        status: "ACTIVE",
        supportForPlatformUserId: null,
        branchRoles: { some: { role: { name: "SUPER_ADMIN" } } },
      },
      select: { id: true },
    });
    const { title, body } = message(stage, sub.isTrial, periodEndsAt);
    const newKey = `${stage}|${periodEndsAt.toISOString()}`;

    const delivered = await prisma.$transaction(async (tx) => {
      const claim = await tx.companySubscription.updateMany({
        where: { id: sub.id, lastNotifiedKey: sub.lastNotifiedKey, currentPeriodEndsAt: periodEndsAt },
        data: { lastNotifiedKey: newKey },
      });
      if (claim.count !== 1) return 0; // another worker got there first, or the period changed
      for (const r of recipients) {
        await createNotification({ companyId: sub.companyId, userId: r.id, title, body }, tx);
      }
      return recipients.length;
    });
    sent += delivered;
  }
  return { checked: subscriptions.length, sent };
}

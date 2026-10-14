import type { Prisma, SubscriptionBillingCycle } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addDays, addMonths, computeSubscriptionStatus } from "@/core/subscriptions/subscription-state";
import type { AdjustPeriodInput, ChangePlanInput, RecordPaymentInput } from "./subscription.schema";
import { resolveTrialPlan } from "./subscription-plan.service";

/**
 * A company's subscription (Platform SaaS Phase 4, PLAT-021..025). Billing is
 * manual (DEC-03): platform staff record a payment, which renews the
 * subscription by whole billing periods. Trial / active / grace / expired is
 * always derived from `currentPeriodEndsAt` (subscription-state.ts).
 */

export interface PlatformActor {
  platformUserId: string;
}

function monthsPerPeriod(cycle: SubscriptionBillingCycle): number {
  return cycle === "ANNUAL" ? 12 : 1;
}

/** Plan, derived state, user usage and payment history for the platform company page. */
export async function getCompanySubscription(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");

  const [subscription, activeUsers, payments] = await Promise.all([
    prisma.companySubscription.findUnique({
      where: { companyId },
      include: {
        plan: { include: { modules: { select: { packageKey: true } } } },
        updatedBy: { select: { fullName: true } },
      },
    }),
    prisma.user.count({ where: { companyId, status: "ACTIVE", supportForPlatformUserId: null } }),
    prisma.subscriptionPayment.findMany({
      where: { companyId },
      include: { plan: { select: { name: true } }, recordedBy: { select: { fullName: true } } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  return {
    subscription,
    status: computeSubscriptionStatus(subscription),
    activeUsers,
    payments,
  };
}

/** Creates the 14-day (plan-configured) trial for a brand-new company, inside its creation transaction. */
export async function startTrialInTx(tx: Prisma.TransactionClient, companyId: string, planId?: string | null) {
  const plan = await resolveTrialPlan(planId);
  const now = new Date();
  return tx.companySubscription.create({
    data: {
      companyId,
      planId: plan.id,
      billingCycle: "MONTHLY",
      isTrial: true,
      startedAt: now,
      currentPeriodEndsAt: plan.trialDays > 0 ? addDays(now, plan.trialDays) : now,
    },
  });
}

async function lockSubscription(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$queryRaw`SELECT id FROM company_subscriptions WHERE company_id = ${companyId}::uuid FOR UPDATE`;
  return tx.companySubscription.findUnique({ where: { companyId } });
}

async function assertActivePlan(planId: string) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new BusinessRuleError("NOT_FOUND", "Plan not found or inactive.");
  return plan;
}

async function assertCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
}

function afterChange(companyId: string) {
  // Plan decides entitlements; dates decide read-only mode (uncached in PermissionService, but clear anyway).
  EntitlementService.invalidate(companyId);
  PermissionService.invalidate();
}

/** Moves the company to another plan / billing cycle without touching its dates. */
export async function changeSubscriptionPlan(actor: PlatformActor, companyId: string, input: ChangePlanInput) {
  await assertCompany(companyId);
  const plan = await assertActivePlan(input.planId);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await lockSubscription(tx, companyId);
    const saved = existing
      ? await tx.companySubscription.update({
          where: { companyId },
          data: { planId: plan.id, billingCycle: input.billingCycle, updatedByPlatformUserId: actor.platformUserId },
        })
      : await tx.companySubscription.create({
          data: {
            companyId,
            planId: plan.id,
            billingCycle: input.billingCycle,
            isTrial: false,
            currentPeriodEndsAt: null,
            updatedByPlatformUserId: actor.platformUserId,
          },
        });
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "company_subscriptions",
        recordId: saved.id,
        action: "UPDATE",
        oldValues: existing ? { planId: existing.planId, billingCycle: existing.billingCycle } : undefined,
        newValues: { planId: plan.id, plan: plan.name, billingCycle: input.billingCycle },
      },
      tx
    );
    return saved;
  });
  afterChange(companyId);
  return result;
}

/**
 * Records a manual payment (DEC-03) and renews the subscription by
 * `periods` billing periods. The new period starts at the current period end
 * if that is still in the future, otherwise today — so paying early never
 * loses time and paying late never back-dates. Ends any trial.
 */
export async function recordSubscriptionPayment(actor: PlatformActor, companyId: string, input: RecordPaymentInput) {
  await assertCompany(companyId);
  const plan = await assertActivePlan(input.planId);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await lockSubscription(tx, companyId);
    const currentEnd = existing?.currentPeriodEndsAt ?? null;
    const periodStart = currentEnd && currentEnd > now ? currentEnd : now;
    const periodEnd = addMonths(periodStart, monthsPerPeriod(input.billingCycle) * input.periods);

    const subscription = existing
      ? await tx.companySubscription.update({
          where: { companyId },
          data: {
            planId: plan.id,
            billingCycle: input.billingCycle,
            isTrial: false,
            currentPeriodEndsAt: periodEnd,
            lastNotifiedKey: null,
            updatedByPlatformUserId: actor.platformUserId,
          },
        })
      : await tx.companySubscription.create({
          data: {
            companyId,
            planId: plan.id,
            billingCycle: input.billingCycle,
            isTrial: false,
            startedAt: now,
            currentPeriodEndsAt: periodEnd,
            updatedByPlatformUserId: actor.platformUserId,
          },
        });

    const payment = await tx.subscriptionPayment.create({
      data: {
        companyId,
        subscriptionId: subscription.id,
        planId: plan.id,
        billingCycle: input.billingCycle,
        periods: input.periods,
        amount: input.amount,
        currencyCode: plan.currencyCode,
        paidAt: new Date(`${input.paidAt}T00:00:00.000Z`),
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        periodStart,
        periodEnd,
        recordedByPlatformUserId: actor.platformUserId,
      },
    });

    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "subscription_payments",
        recordId: payment.id,
        action: "CREATE",
        oldValues: existing
          ? { planId: existing.planId, isTrial: existing.isTrial, currentPeriodEndsAt: existing.currentPeriodEndsAt }
          : undefined,
        newValues: {
          plan: plan.name,
          billingCycle: input.billingCycle,
          periods: input.periods,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          periodStart,
          periodEnd,
        },
      },
      tx
    );
    return { subscription, payment };
  });
  afterChange(companyId);
  return result;
}

/** Manual correction: extend a trial, grant extra time, set an exact end date, or remove the expiry. */
export async function adjustSubscriptionPeriod(actor: PlatformActor, companyId: string, input: AdjustPeriodInput) {
  await assertCompany(companyId);
  const newEnd = input.noExpiry ? null : new Date(`${input.periodEndsAt}T23:59:59.999Z`);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await lockSubscription(tx, companyId);
    if (!existing) {
      throw new BusinessRuleError("VALIDATION_ERROR", "This company has no subscription yet. Change its plan or record a payment first.");
    }
    const isTrial = input.noExpiry ? false : (input.isTrial ?? existing.isTrial);
    const saved = await tx.companySubscription.update({
      where: { companyId },
      data: { currentPeriodEndsAt: newEnd, isTrial, lastNotifiedKey: null, updatedByPlatformUserId: actor.platformUserId },
    });
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "company_subscriptions",
        recordId: saved.id,
        action: "UPDATE",
        oldValues: { currentPeriodEndsAt: existing.currentPeriodEndsAt, isTrial: existing.isTrial },
        newValues: { currentPeriodEndsAt: newEnd, isTrial, reason: input.reason },
      },
      tx
    );
    return saved;
  });
  afterChange(companyId);
  return result;
}

/**
 * Plan user limit (PLAT-022 quota). Called before a user is created or
 * reactivated. Support proxy users never count.
 */
export async function assertUserLimitAllows(companyId: string, additionalUsers = 1) {
  const subscription = await prisma.companySubscription.findUnique({
    where: { companyId },
    select: { plan: { select: { name: true, maxUsers: true } } },
  });
  const maxUsers = subscription?.plan.maxUsers ?? null;
  if (maxUsers === null) return;
  const activeUsers = await prisma.user.count({ where: { companyId, status: "ACTIVE", supportForPlatformUserId: null } });
  if (activeUsers + additionalUsers > maxUsers) {
    throw new BusinessRuleError(
      "SUBSCRIPTION_LIMIT_REACHED",
      `Your ${subscription!.plan.name} plan allows ${maxUsers} active users and you have ${activeUsers}. Suspend a user or ask the platform team to upgrade your plan.`,
      { maxUsers, activeUsers }
    );
  }
}

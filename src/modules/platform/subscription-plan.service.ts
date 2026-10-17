import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import type { SubscriptionPlanInput } from "./subscription.schema";

/**
 * Subscription plan catalog (Platform SaaS Phase 4, PLAT-022). A plan sets
 * prices (monthly / annual), trial length, a user limit and which module
 * packages are included. Plans are platform-wide, not per company, so plan
 * changes are recorded in the application log rather than a company's audit
 * trail.
 */

export interface PlatformActor {
  platformUserId: string;
}

const planInclude = {
  modules: { select: { packageKey: true }, orderBy: { packageKey: "asc" } },
  _count: { select: { subscriptions: true } },
} as const;

export async function listSubscriptionPlans(options: { activeOnly?: boolean } = {}) {
  return prisma.subscriptionPlan.findMany({
    where: options.activeOnly ? { isActive: true } : undefined,
    include: planInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getSubscriptionPlan(id: string) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, include: planInclude });
  if (!plan) throw new BusinessRuleError("NOT_FOUND", "Plan not found.");
  return plan;
}

async function assertCodeFree(code: string, excludeId?: string) {
  const clash = await prisma.subscriptionPlan.findUnique({ where: { code } });
  if (clash && clash.id !== excludeId) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `A plan with code "${code}" already exists.`, { code });
  }
}

function planData(input: SubscriptionPlanInput) {
  return {
    code: input.code,
    name: input.name,
    description: input.description,
    monthlyPrice: input.monthlyPrice,
    annualPrice: input.annualPrice,
    currencyCode: input.currencyCode,
    trialDays: input.trialDays,
    maxUsers: input.maxUsers,
    isActive: input.isActive,
    isDefaultTrialPlan: input.isDefaultTrialPlan,
    sortOrder: input.sortOrder,
  };
}

function assertDefaultIsActive(input: SubscriptionPlanInput) {
  if (input.isDefaultTrialPlan && !input.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The default trial plan must be active.");
  }
}

export async function createSubscriptionPlan(_actor: PlatformActor, input: SubscriptionPlanInput) {
  assertDefaultIsActive(input);
  await assertCodeFree(input.code);
  const plan = await prisma.$transaction(async (tx) => {
    // Only one plan may be the default trial plan (also a partial unique index).
    if (input.isDefaultTrialPlan) {
      await tx.subscriptionPlan.updateMany({ where: { isDefaultTrialPlan: true }, data: { isDefaultTrialPlan: false } });
    }
    return tx.subscriptionPlan.create({
      data: { ...planData(input), modules: { create: [...new Set(input.modules)].map((packageKey) => ({ packageKey })) } },
      include: planInclude,
    });
  });
  return plan;
}

export async function updateSubscriptionPlan(_actor: PlatformActor, id: string, input: SubscriptionPlanInput) {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Plan not found.");
  assertDefaultIsActive(input);
  await assertCodeFree(input.code, id);

  const plan = await prisma.$transaction(async (tx) => {
    if (input.isDefaultTrialPlan && !existing.isDefaultTrialPlan) {
      await tx.subscriptionPlan.updateMany({ where: { isDefaultTrialPlan: true }, data: { isDefaultTrialPlan: false } });
    }
    await tx.subscriptionPlanModule.deleteMany({ where: { planId: id } });
    return tx.subscriptionPlan.update({
      where: { id },
      data: { ...planData(input), modules: { create: [...new Set(input.modules)].map((packageKey) => ({ packageKey })) } },
      include: planInclude,
    });
  });
  // The plan's modules decide every subscribed company's entitlements.
  EntitlementService.invalidate();
  return plan;
}

/** The plan a newly created company starts its trial on. */
export async function resolveTrialPlan(planId?: string | null) {
  if (planId) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new BusinessRuleError("NOT_FOUND", "Plan not found or inactive.");
    return plan;
  }
  const plan =
    (await prisma.subscriptionPlan.findFirst({ where: { isDefaultTrialPlan: true, isActive: true } })) ??
    (await prisma.subscriptionPlan.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  if (!plan) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No active subscription plan exists. Create one under Platform → Plans first.");
  }
  return plan;
}

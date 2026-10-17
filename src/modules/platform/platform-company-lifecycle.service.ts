import { prisma } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EntitlementService } from "@/core/entitlements/EntitlementService";
import { getEntitlementPackage, type EntitlementPackageKey } from "@/config/module-entitlements";
import { computeSubscriptionStatus } from "@/core/subscriptions/subscription-state";
import type { UpdateCompanyDetailsInput } from "./platform-company-lifecycle.schema";

/**
 * Company lifecycle for platform operators (Platform SaaS Phase 3,
 * PLAT-016/018): inspect a tenant, edit its details, suspend or reactivate
 * it, and turn product modules on or off. Every change is audited under the
 * company's own id and attributed to the platform operator.
 */

export interface PlatformActor {
  platformUserId: string;
}

/** Real tenant users only — never a support proxy user. */
const REAL_USERS = { supportForPlatformUserId: null } as const;

async function findCompanyOrThrow(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
  return company;
}

/** Every company with a few headline numbers, for the platform list. */
export async function listCompanySummaries() {
  const [companies, userCounts, lastLogins] = await Promise.all([
    prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      include: { subscription: { select: { isTrial: true, currentPeriodEndsAt: true, plan: { select: { name: true } } } } },
    }),
    prisma.user.groupBy({ by: ["companyId"], where: { ...REAL_USERS, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ["companyId"], where: REAL_USERS, _max: { lastLoginAt: true } }),
  ]);
  const usersBy = new Map(userCounts.map((r) => [r.companyId, r._count._all]));
  const loginBy = new Map(lastLogins.map((r) => [r.companyId, r._max.lastLoginAt]));
  const disabledCounts = await Promise.all(
    companies.map(async (c) => (await EntitlementService.getDisabledPackages(c.id)).size)
  );
  return companies.map(({ subscription, ...c }, i) => {
    const status = computeSubscriptionStatus(subscription);
    return {
      ...c,
      activeUsers: usersBy.get(c.id) ?? 0,
      lastLoginAt: loginBy.get(c.id) ?? null,
      disabledModuleCount: disabledCounts[i],
      planName: subscription?.plan.name ?? null,
      subscriptionState: status.state,
      periodEndsAt: status.periodEndsAt,
    };
  });
}

/** One company: details, usage statistics and module states (PLAT-016). */
export async function getCompanyDetail(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { suspendedByPlatformUser: { select: { fullName: true } } },
  });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");

  const where = { companyId };
  const [
    totalUsers,
    activeUsers,
    lastLogin,
    branches,
    customers,
    suppliers,
    styles,
    salesOrders,
    productionOrders,
    dispatches,
    attachments,
    supportRequests,
    liveSupportSessions,
    modules,
  ] = await Promise.all([
    prisma.user.count({ where: { ...where, ...REAL_USERS } }),
    prisma.user.count({ where: { ...where, ...REAL_USERS, status: "ACTIVE" } }),
    prisma.user.aggregate({ where: { ...where, ...REAL_USERS }, _max: { lastLoginAt: true } }),
    prisma.branch.count({ where }),
    prisma.customer.count({ where: { ...where, deletedAt: null } }),
    prisma.supplier.count({ where: { ...where, deletedAt: null } }),
    prisma.product.count({ where: { ...where, itemType: "STYLE" } }),
    prisma.salesOrder.count({ where }),
    prisma.productionOrder.count({ where }),
    prisma.dispatch.count({ where }),
    prisma.attachment.aggregate({ where, _count: { _all: true }, _sum: { fileSizeBytes: true } }),
    prisma.supportAccessRequest.count({ where }),
    prisma.supportAccessSession.count({
      where: { ...where, revokedAt: null, endedAt: null, expiresAt: { gt: new Date() } },
    }),
    EntitlementService.listPackageStates(companyId),
  ]);

  return {
    company: {
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      taxRegistrationNo: company.taxRegistrationNo,
      baseCurrencyCode: company.baseCurrencyCode,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      isActive: company.isActive,
      suspendedAt: company.suspendedAt,
      suspensionReason: company.suspensionReason,
      suspendedBy: company.suspendedByPlatformUser?.fullName ?? null,
      createdAt: company.createdAt,
    },
    stats: {
      totalUsers,
      activeUsers,
      lastLoginAt: lastLogin._max.lastLoginAt,
      branches,
      customers,
      suppliers,
      styles,
      salesOrders,
      productionOrders,
      dispatches,
      attachments: attachments._count._all,
      storageBytes: attachments._sum.fileSizeBytes ?? 0,
      supportRequests,
      liveSupportSessions,
    },
    modules: modules.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      isEnabled: m.isEnabled,
      inPlan: m.inPlan,
      override: m.override,
    })),
  };
}

export async function updateCompanyDetails(actor: PlatformActor, companyId: string, input: UpdateCompanyDetailsInput) {
  const before = await findCompanyOrThrow(companyId);
  if (input.taxRegistrationNo && input.taxRegistrationNo !== before.taxRegistrationNo) {
    const clash = await prisma.company.findUnique({ where: { taxRegistrationNo: input.taxRegistrationNo } });
    if (clash && clash.id !== companyId) {
      throw new BusinessRuleError(
        "DUPLICATE_TAX_REGISTRATION_NO",
        `Another company already uses tax registration "${input.taxRegistrationNo}".`,
        { taxRegistrationNo: input.taxRegistrationNo }
      );
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    const company = await tx.company.update({
      where: { id: companyId },
      data: {
        name: input.name,
        legalName: input.legalName,
        taxRegistrationNo: input.taxRegistrationNo,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
      },
    });
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "companies",
        recordId: companyId,
        action: "UPDATE",
        oldValues: {
          name: before.name,
          legalName: before.legalName,
          taxRegistrationNo: before.taxRegistrationNo,
          fiscalYearStartMonth: before.fiscalYearStartMonth,
        },
        newValues: { ...input },
      },
      tx
    );
    return company;
  });
  return updated;
}

/**
 * Suspends a company: its users are refused at login, every API and every
 * page from the next request (PLAT-006), and any live support session ends.
 */
export async function suspendCompany(actor: PlatformActor, companyId: string, reason: string) {
  await findCompanyOrThrow(companyId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.company.updateMany({
      where: { id: companyId, isActive: true },
      data: {
        isActive: false,
        suspendedAt: new Date(),
        suspensionReason: reason,
        suspendedByPlatformUserId: actor.platformUserId,
      },
    });
    if (updated.count !== 1) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This company is already suspended.");
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "companies",
        recordId: companyId,
        action: "UPDATE",
        oldValues: { isActive: true },
        newValues: { isActive: false, suspensionReason: reason },
      },
      tx
    );
  });
}

export async function activateCompany(actor: PlatformActor, companyId: string) {
  const before = await findCompanyOrThrow(companyId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.company.updateMany({
      where: { id: companyId, isActive: false },
      data: { isActive: true, suspendedAt: null, suspensionReason: null, suspendedByPlatformUserId: null },
    });
    if (updated.count !== 1) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This company is already active.");
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "companies",
        recordId: companyId,
        action: "UPDATE",
        oldValues: { isActive: false, suspensionReason: before.suspensionReason },
        newValues: { isActive: true },
      },
      tx
    );
  });
}

/** Turns one product package on or off for a company (PLAT-020). */
export async function setModuleEntitlement(
  actor: PlatformActor,
  companyId: string,
  packageKey: EntitlementPackageKey,
  isEnabled: boolean
) {
  await findCompanyOrThrow(companyId);
  const pkg = getEntitlementPackage(packageKey);
  const before = await prisma.companyModuleEntitlement.findUnique({
    where: { companyId_packageKey: { companyId, packageKey } },
  });
  const wasEnabled = before?.isEnabled ?? true;

  await prisma.$transaction(async (tx) => {
    await tx.companyModuleEntitlement.upsert({
      where: { companyId_packageKey: { companyId, packageKey } },
      create: { companyId, packageKey, isEnabled, changedByPlatformUserId: actor.platformUserId },
      update: { isEnabled, changedByPlatformUserId: actor.platformUserId },
    });
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "company_module_entitlements",
        recordId: companyId,
        action: "UPDATE",
        oldValues: { package: packageKey, isEnabled: wasEnabled },
        newValues: { package: packageKey, label: pkg.label, isEnabled },
      },
      tx
    );
  });
  EntitlementService.invalidate(companyId);
  return { key: packageKey, label: pkg.label, isEnabled };
}

/** Removes a per-company module override so the subscription plan decides again (Phase 4). */
export async function resetModuleEntitlement(actor: PlatformActor, companyId: string, packageKey: EntitlementPackageKey) {
  await findCompanyOrThrow(companyId);
  const pkg = getEntitlementPackage(packageKey);
  const before = await prisma.companyModuleEntitlement.findUnique({
    where: { companyId_packageKey: { companyId, packageKey } },
  });
  if (!before) return { key: packageKey, label: pkg.label, reset: false };

  await prisma.$transaction(async (tx) => {
    await tx.companyModuleEntitlement.delete({ where: { id: before.id } });
    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "company_module_entitlements",
        recordId: companyId,
        action: "DELETE",
        oldValues: { package: packageKey, isEnabled: before.isEnabled },
        newValues: { package: packageKey, label: pkg.label, override: null },
      },
      tx
    );
  });
  EntitlementService.invalidate(companyId);
  return { key: packageKey, label: pkg.label, reset: true };
}

/** Lists real users of a tenant for platform operator diagnostics and support. */
export async function listCompanyUsers(companyId: string) {
  await findCompanyOrThrow(companyId);
  const users = await prisma.user.findMany({
    where: { companyId, ...REAL_USERS },
    orderBy: { createdAt: "asc" },
    include: {
      branchRoles: {
        include: {
          role: { select: { name: true } },
          branch: { select: { name: true } },
        },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    passwordChangedAt: u.passwordChangedAt,
    createdAt: u.createdAt,
    roles: u.branchRoles.map((br) => ({
      roleName: br.role.name,
      branchName: br.branch.name,
    })),
  }));
}

/** Allows a platform operator to reset a tenant user's password when locked out. */
export async function resetCompanyUserPassword(
  actor: PlatformActor,
  companyId: string,
  userId: string,
  newPassword: string
) {
  await findCompanyOrThrow(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, ...REAL_USERS },
  });
  if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found for this company.");

  if (!newPassword || newPassword.length < 8) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Password must be at least 8 characters long.");
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });

    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "users",
        recordId: userId,
        action: "UPDATE",
        oldValues: { email: user.email },
        newValues: { email: user.email, passwordResetByPlatform: true },
      },
      tx
    );
  });

  return { success: true, email: user.email };
}

/** Allows a platform operator to suspend or reactivate a specific tenant user. */
export async function toggleCompanyUserStatus(
  actor: PlatformActor,
  companyId: string,
  userId: string,
  status: "ACTIVE" | "SUSPENDED"
) {
  await findCompanyOrThrow(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, ...REAL_USERS },
  });
  if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found for this company.");

  const oldStatus = user.status;
  if (oldStatus === status) return { success: true, status };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status },
    });

    await writeAuditLog(
      {
        companyId,
        platformUserId: actor.platformUserId,
        tableName: "users",
        recordId: userId,
        action: "UPDATE",
        oldValues: { email: user.email, status: oldStatus },
        newValues: { email: user.email, status },
      },
      tx
    );
  });

  return { success: true, status };
}

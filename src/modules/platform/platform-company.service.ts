import { prisma } from "@/core/db/client";
import { hashPassword } from "@/core/auth/password";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { MODULES, ROLES, ROLE_PERMISSIONS, permissionKey } from "@/config/rbac";
import type { CreateCompanyInput } from "./platform-company.schema";

/** A platform operator (platform_users.id) — never a tenant user. */
interface PlatformActorContext {
  platformUserId: string;
}

export async function listCompanies() {
  return prisma.company.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * Bootstraps a brand-new, fully independent tenant — replicates exactly
 * what prisma/seed.ts does for the very first company, as a live,
 * platform-admin-triggered action instead of a one-off script. Every table
 * in this schema is already company-scoped from Phase 1 planning, so a new
 * company's data is automatically isolated from every other one — this
 * function's only job is to bootstrap the minimum a company needs to
 * actually be usable: itself, one branch, its own 13 roles (reusing the
 * SAME global Permission catalog every company shares — only Role/
 * RolePermission are per-company, so nothing needs re-seeding there), and
 * its own first Super Admin login.
 */
export async function createCompany(actor: PlatformActorContext, input: CreateCompanyInput) {
  if (input.taxRegistrationNo) {
    const existingCompany = await prisma.company.findUnique({ where: { taxRegistrationNo: input.taxRegistrationNo } });
    if (existingCompany) {
      throw new BusinessRuleError(
        "DUPLICATE_TAX_REGISTRATION_NO",
        `A company with tax registration "${input.taxRegistrationNo}" already exists.`,
        { taxRegistrationNo: input.taxRegistrationNo }
      );
    }
  }

  // User.email is globally unique across every company in this app, not
  // per-tenant — so the new company's own admin login can collide with a
  // completely unrelated company's user, and needs checking here.
  const existingUser = await prisma.user.findUnique({ where: { email: input.adminEmail } });
  if (existingUser) {
    throw new BusinessRuleError("DUPLICATE_EMAIL_EXISTS", `A user with email "${input.adminEmail}" already exists.`, {
      email: input.adminEmail,
    });
  }

  const currency = await prisma.currency.findUnique({ where: { code: input.baseCurrencyCode } });
  if (!currency) {
    throw new BusinessRuleError("NOT_FOUND", "Currency not found.", { code: input.baseCurrencyCode });
  }

  const passwordHash = await hashPassword(input.adminPassword);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        legalName: input.legalName || null,
        taxRegistrationNo: input.taxRegistrationNo || null,
        baseCurrencyCode: input.baseCurrencyCode,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
        isActive: true,
      },
    });

    const branch = await tx.branch.create({
      data: { companyId: company.id, code: input.branchCode, name: input.branchName, type: input.branchType },
    });

    const allPermissions = await tx.permission.findMany();
    const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

    const roleIdByName = new Map<string, string>();
    for (const roleName of ROLES) {
      const role = await tx.role.create({ data: { companyId: company.id, name: roleName, isSystemRole: true } });
      roleIdByName.set(roleName, role.id);

      const modulesForRole = ROLE_PERMISSIONS[roleName];
      const rolePermissionData = Object.entries(modulesForRole).flatMap(([mod, actions]) =>
        (actions ?? []).map((action) => {
          const key = permissionKey(mod as (typeof MODULES)[number], action);
          const permissionId = permissionIdByKey.get(key);
          if (!permissionId) throw new Error(`Unknown permission key: ${key}`);
          return { roleId: role.id, permissionId };
        })
      );
      if (rolePermissionData.length > 0) {
        await tx.rolePermission.createMany({ data: rolePermissionData });
      }
    }

    const superAdminUser = await tx.user.create({
      data: {
        companyId: company.id,
        defaultBranchId: branch.id,
        email: input.adminEmail,
        passwordHash,
        fullName: input.adminFullName,
        status: "ACTIVE",
      },
    });

    const superAdminRoleId = roleIdByName.get("SUPER_ADMIN")!;
    await tx.userBranchRole.create({
      data: { userId: superAdminUser.id, branchId: branch.id, roleId: superAdminRoleId },
    });

    return { company, branch, adminUser: superAdminUser };
  });

  // Logged under the new company's own id — the first entry in that
  // company's own audit trail — and attributed to the platform operator via
  // platformUserId (they are not a user of this or any company).
  await writeAuditLog({
    companyId: result.company.id,
    platformUserId: actor.platformUserId,
    tableName: "companies",
    recordId: result.company.id,
    action: "CREATE",
    newValues: { name: result.company.name, taxRegistrationNo: result.company.taxRegistrationNo, adminEmail: input.adminEmail },
  });

  return result;
}

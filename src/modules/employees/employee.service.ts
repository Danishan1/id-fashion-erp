import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import { HrConfigRepository } from "@/modules/hr-config/hr-config.repository";
import type { ListQuery } from "@/lib/list-query";
import type { CreateEmployeeInput, EmployeeInput, EmployeeLoginInput, EmployeeUpdateInput } from "./employee.schema";
import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  assertNewLoginAllowed,
  createEmployeeLoginInTx,
  suspendLoginForEmployee,
} from "@/modules/administration/user-admin.service";
import { EmployeeRepository } from "./employee.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listEmployees(companyId: string, query: ListQuery) {
  const where = {
    companyId,
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: "insensitive" as const } },
            { employeeCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    EmployeeRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    EmployeeRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getEmployeeById(companyId: string, id: string) {
  const employee = await EmployeeRepository.findById(companyId, id);
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id });
  return employee;
}

/** Tenant-scope check on a designationId before it's ever written — an
 * unchecked FK from client input is exactly the class of bug this project
 * has found and fixed repeatedly (see CLAUDE.md's 2026-08-19 cross-tenant
 * sweep). Cheap here since this is a low-frequency master-data pick, not a
 * hot path. */
async function assertDesignationBelongsToCompany(companyId: string, designationId: string) {
  const designation = await HrConfigRepository.designation.findFirst({ where: { id: designationId, companyId } });
  if (!designation) throw new BusinessRuleError("NOT_FOUND", "Designation not found.", { id: designationId });
}

/** Same tenant-scope discipline as the designation check above. */
async function assertEmployeeCategoryBelongsToCompany(companyId: string, employeeCategoryId: string) {
  const category = await HrConfigRepository.employeeCategory.findFirst({ where: { id: employeeCategoryId, companyId } });
  if (!category) throw new BusinessRuleError("NOT_FOUND", "Employee category not found.", { id: employeeCategoryId });
}

/** Same tenant-scope discipline as the designation check above, plus the
 * one business rule a reporting hierarchy actually needs: an employee can't
 * report to themselves. Deeper cycle detection (A -> B -> A) isn't checked —
 * this is a display/org-chart hierarchy, not a workflow gate anything is
 * enforced against, so a longer cycle is a data-entry mistake to notice and
 * fix on sight, not a state a live business process could get stuck in. */
async function assertReportsToIsValid(companyId: string, reportsToId: string, selfId?: string) {
  if (reportsToId === selfId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An employee cannot report to themselves.");
  }
  const manager = await EmployeeRepository.findById(companyId, reportsToId);
  if (!manager) throw new BusinessRuleError("NOT_FOUND", "Reporting manager not found.", { id: reportsToId });
}

/** Work Skills must be this company's own production stages. */
async function normalizeWorkSkills(companyId: string, stageIds: string[] | undefined) {
  if (stageIds === undefined) return undefined;
  const unique = [...new Set(stageIds)];
  if (unique.length === 0) return unique;
  const found = await EmployeeRepository.countCompanyStages(companyId, unique);
  if (found !== unique.length) {
    throw new BusinessRuleError("NOT_FOUND", "One or more selected Work Skills are not production stages of this company.", {});
  }
  return unique;
}

function toData(input: EmployeeInput) {
  return {
    employeeCode: input.employeeCode,
    fullName: input.fullName,
    departmentId: input.departmentId || null,
    shiftId: input.shiftId || null,
    designationId: input.designationId || null,
    employeeCategoryId: input.employeeCategoryId || null,
    reportsToId: input.reportsToId || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    city: input.city || null,
    pinCode: input.pinCode || null,
    country: input.country || null,
    joinDate: input.joinDate ? new Date(input.joinDate) : null,
    isActive: input.isActive ?? true,
    payType: input.payType || null,
    fixedMonthlySalary: input.fixedMonthlySalary ?? null,
    pieceRatePerUnit: input.pieceRatePerUnit ?? null,
    travelAllowance: input.travelAllowance ?? null,
    dearnessAllowance: input.dearnessAllowance ?? null,
    selfEntryEnabled: input.selfEntryEnabled ?? false,
  };
}

/** Only includes keys actually present in a partial PATCH body — omitted fields are left untouched in the DB. */
function toUpdateData(input: EmployeeUpdateInput): Prisma.EmployeeUncheckedUpdateInput {
  const data: Prisma.EmployeeUncheckedUpdateInput = {};
  if (input.employeeCode !== undefined) data.employeeCode = input.employeeCode;
  if (input.fullName !== undefined) data.fullName = input.fullName;
  if (input.departmentId !== undefined) data.departmentId = input.departmentId || null;
  if (input.shiftId !== undefined) data.shiftId = input.shiftId || null;
  if (input.designationId !== undefined) data.designationId = input.designationId || null;
  if (input.employeeCategoryId !== undefined) data.employeeCategoryId = input.employeeCategoryId || null;
  if (input.reportsToId !== undefined) data.reportsToId = input.reportsToId || null;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.email !== undefined) data.email = input.email || null;
  if (input.address !== undefined) data.address = input.address || null;
  if (input.city !== undefined) data.city = input.city || null;
  if (input.pinCode !== undefined) data.pinCode = input.pinCode || null;
  if (input.country !== undefined) data.country = input.country || null;
  if (input.joinDate !== undefined) data.joinDate = input.joinDate ? new Date(input.joinDate) : null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.payType !== undefined) data.payType = input.payType || null;
  if (input.fixedMonthlySalary !== undefined) data.fixedMonthlySalary = input.fixedMonthlySalary ?? null;
  if (input.pieceRatePerUnit !== undefined) data.pieceRatePerUnit = input.pieceRatePerUnit ?? null;
  if (input.travelAllowance !== undefined) data.travelAllowance = input.travelAllowance ?? null;
  if (input.dearnessAllowance !== undefined) data.dearnessAllowance = input.dearnessAllowance ?? null;
  if (input.selfEntryEnabled !== undefined) data.selfEntryEnabled = input.selfEntryEnabled;
  return data;
}

/**
 * P2: giving someone an ERP login is an administration action, not just a
 * masters edit -- it needs administration_users.create on top of the
 * employee permission, and the same checks as Admin -> Users.
 */
async function prepareEmployeeLogin(actor: ActorContext, email: string | undefined | null, login: EmployeeLoginInput) {
  await PermissionService.assert(actor.userId, "administration_users", "create");
  if (!email) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An email address is needed to create a login -- it becomes the username.", {
      field: "email",
    });
  }
  return assertNewLoginAllowed(actor, { email, branchId: login.branchId, roleId: login.roleId });
}

async function auditLoginCreated(actor: ActorContext, userId: string, employeeId: string, email: string, login: EmployeeLoginInput) {
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "users",
    recordId: userId,
    action: "CREATE",
    // Never the password -- only that a temporary one was issued.
    newValues: { email, employeeId, roleId: login.roleId, branchId: login.branchId, temporaryPassword: true, mustChangePassword: true },
  });
}

export async function createEmployee(actor: ActorContext, rawInput: CreateEmployeeInput) {
  const { login, ...input } = rawInput;
  const existing = await EmployeeRepository.findByCode(actor.companyId, input.employeeCode);
  if (existing) {
    throw new BusinessRuleError(
      "DUPLICATE_DOC_NUMBER",
      `Employee code "${input.employeeCode}" is already in use.`
    );
  }
  if (input.designationId) {
    await assertDesignationBelongsToCompany(actor.companyId, input.designationId);
  }
  if (input.employeeCategoryId) {
    await assertEmployeeCategoryBelongsToCompany(actor.companyId, input.employeeCategoryId);
  }
  if (input.reportsToId) {
    await assertReportsToIsValid(actor.companyId, input.reportsToId);
  }

  const workSkills = await normalizeWorkSkills(actor.companyId, input.workSkillStageIds);
  const loginEmail = login ? await prepareEmployeeLogin(actor, input.email, login) : null;

  // One transaction: if the login can't be created, the employee isn't saved either.
  const { employee, user } = await prisma.$transaction(async (tx) => {
    const employee = await EmployeeRepository.createInTx(tx, { companyId: actor.companyId, ...toData(input) });
    if (workSkills && workSkills.length > 0) {
      await tx.employeeWorkSkill.createMany({
        data: workSkills.map((productionStageId) => ({ employeeId: employee.id, productionStageId })),
        skipDuplicates: true,
      });
    }
    const user =
      login && loginEmail
        ? await createEmployeeLoginInTx(tx, actor, {
            email: loginEmail,
            fullName: employee.fullName,
            phone: employee.phone,
            branchId: login.branchId,
            roleId: login.roleId,
            employeeId: employee.id,
          })
        : null;
    return { employee, user };
  });

  await advanceMasterCodeSequence(actor.companyId, "EMPLOYEE");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employees",
    recordId: employee.id,
    action: "CREATE",
    newValues: { ...employee, workSkillStageIds: workSkills ?? [] },
  });
  if (user && login && loginEmail) await auditLoginCreated(actor, user.id, employee.id, loginEmail, login);

  return { ...employee, loginUserId: user?.id ?? null };
}

/** P2: the employee's linked login (email/status only -- never the hash). */
export async function getEmployeeLogin(companyId: string, employeeId: string) {
  return prisma.user.findFirst({
    where: { companyId, employeeId },
    select: { email: true, status: true, mustChangePassword: true },
  });
}

/**
 * P2: a login for an existing employee who doesn't have one. Never creates a
 * second login -- an employee already linked, or an email already used by
 * any login, is refused (link it from Admin -> Users instead).
 */
export async function createLoginForEmployee(actor: ActorContext, employeeId: string, login: EmployeeLoginInput) {
  const employee = await getEmployeeById(actor.companyId, employeeId);
  if (!employee.isActive) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Reactivate this employee before creating a login.", {});
  }
  if (await EmployeeRepository.findLinkedUserId(employeeId)) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", "This employee already has a login.", { employeeId });
  }
  const email = await prepareEmployeeLogin(actor, employee.email, login);
  const user = await prisma.$transaction((tx) =>
    createEmployeeLoginInTx(tx, actor, {
      email,
      fullName: employee.fullName,
      phone: employee.phone,
      branchId: login.branchId,
      roleId: login.roleId,
      employeeId,
    })
  );
  await auditLoginCreated(actor, user.id, employeeId, email, login);
  return user;
}

export async function updateEmployee(actor: ActorContext, id: string, input: EmployeeUpdateInput) {
  const before = await getEmployeeById(actor.companyId, id);

  if (input.employeeCode !== undefined && input.employeeCode !== before.employeeCode) {
    const codeInUse = await EmployeeRepository.findByCode(actor.companyId, input.employeeCode, id);
    if (codeInUse) {
      throw new BusinessRuleError(
        "DUPLICATE_DOC_NUMBER",
        `Employee code "${input.employeeCode}" is already in use.`
      );
    }
  }
  if (input.designationId) {
    await assertDesignationBelongsToCompany(actor.companyId, input.designationId);
  }
  if (input.employeeCategoryId) {
    await assertEmployeeCategoryBelongsToCompany(actor.companyId, input.employeeCategoryId);
  }
  if (input.reportsToId) {
    await assertReportsToIsValid(actor.companyId, input.reportsToId, id);
  }

  const workSkills = await normalizeWorkSkills(actor.companyId, input.workSkillStageIds);

  const updated = await EmployeeRepository.update(id, toUpdateData(input));
  if (workSkills !== undefined) await EmployeeRepository.replaceWorkSkills(id, workSkills);
  if (before.isActive && updated.isActive === false) await suspendLoginForEmployee(actor, id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employees",
    recordId: id,
    action: "UPDATE",
    oldValues: { ...before, workSkillStageIds: (before.workSkills ?? []).map((w) => w.productionStageId) },
    newValues: workSkills !== undefined ? { ...updated, workSkillStageIds: workSkills } : updated,
  });

  return updated;
}

export async function setEmployeeActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getEmployeeById(actor.companyId, id);
  const updated = await EmployeeRepository.update(id, { isActive });
  // P2 decision 7: deactivating suspends the linked login. Reactivating
  // deliberately does NOT reopen it -- an admin does that in Users.
  if (!isActive) await suspendLoginForEmployee(actor, id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employees",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function deactivateEmployee(actor: ActorContext, id: string) {
  const before = await getEmployeeById(actor.companyId, id);
  const updated = await EmployeeRepository.update(id, { isActive: false, deletedAt: new Date() });
  await suspendLoginForEmployee(actor, id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employees",
    recordId: id,
    action: "DELETE",
    oldValues: before,
  });

  return updated;
}

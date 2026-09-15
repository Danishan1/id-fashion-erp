import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import { HrConfigRepository } from "@/modules/hr-config/hr-config.repository";
import type { ListQuery } from "@/lib/list-query";
import type { EmployeeInput, EmployeeUpdateInput } from "./employee.schema";
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

export async function createEmployee(actor: ActorContext, input: EmployeeInput) {
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

  const employee = await EmployeeRepository.create({ companyId: actor.companyId, ...toData(input) });

  await advanceMasterCodeSequence(actor.companyId, "EMPLOYEE");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employees",
    recordId: employee.id,
    action: "CREATE",
    newValues: employee,
  });

  return employee;
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

  const updated = await EmployeeRepository.update(id, toUpdateData(input));

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

export async function setEmployeeActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getEmployeeById(actor.companyId, id);
  const updated = await EmployeeRepository.update(id, { isActive });

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

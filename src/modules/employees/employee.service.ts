import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { EmployeeInput } from "./employee.schema";
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

function toData(input: EmployeeInput) {
  return {
    employeeCode: input.employeeCode,
    fullName: input.fullName,
    departmentId: input.departmentId || null,
    designation: input.designation || null,
    phone: input.phone || null,
    email: input.email || null,
    joinDate: input.joinDate ? new Date(input.joinDate) : null,
    isActive: input.isActive,
  };
}

export async function createEmployee(actor: ActorContext, input: EmployeeInput) {
  const existing = await EmployeeRepository.findByCode(actor.companyId, input.employeeCode);
  if (existing) {
    throw new BusinessRuleError(
      "DUPLICATE_DOC_NUMBER",
      `Employee code "${input.employeeCode}" is already in use.`
    );
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

export async function updateEmployee(actor: ActorContext, id: string, input: EmployeeInput) {
  const before = await getEmployeeById(actor.companyId, id);

  if (input.employeeCode !== before.employeeCode) {
    const codeInUse = await EmployeeRepository.findByCode(actor.companyId, input.employeeCode, id);
    if (codeInUse) {
      throw new BusinessRuleError(
        "DUPLICATE_DOC_NUMBER",
        `Employee code "${input.employeeCode}" is already in use.`
      );
    }
  }

  const updated = await EmployeeRepository.update(id, toData(input));

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

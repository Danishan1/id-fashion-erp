import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type {
  DesignationInput,
  EmployeeCategoryInput,
  HolidayMasterInput,
  ShiftMasterInput,
} from "./hr-config.schema";
import { HrConfigRepository } from "./hr-config.repository";
import { DepartmentRepository } from "@/modules/departments/department.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

// ── Designations ──────────────────────────────────────────────────────────

export async function listDesignations(companyId: string) {
  return HrConfigRepository.designation.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

async function assertValidDepartment(companyId: string, departmentId: string) {
  const department = await DepartmentRepository.findFirst({ where: { id: departmentId, companyId } });
  if (!department) throw new BusinessRuleError("NOT_FOUND", "Department not found.", { id: departmentId });
}

export async function createDesignation(actor: ActorContext, input: DesignationInput) {
  const existing = await HrConfigRepository.designation.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Designation code "${input.code}" is already in use.`);

  if (input.departmentId) await assertValidDepartment(actor.companyId, input.departmentId);

  const designation = await HrConfigRepository.designation.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, departmentId: input.departmentId || null, isActive: input.isActive ?? true },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "designations",
    recordId: designation.id,
    action: "CREATE",
    newValues: designation,
  });

  return designation;
}

export async function updateDesignation(actor: ActorContext, id: string, input: DesignationInput) {
  const existing = await HrConfigRepository.designation.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Designation not found.", { id });

  if (input.departmentId) await assertValidDepartment(actor.companyId, input.departmentId);

  const updated = await HrConfigRepository.designation.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      departmentId: input.departmentId || null,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "designations",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Employee Categories ───────────────────────────────────────────────────

export async function listEmployeeCategories(companyId: string) {
  return HrConfigRepository.employeeCategory.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createEmployeeCategory(actor: ActorContext, input: EmployeeCategoryInput) {
  const existing = await HrConfigRepository.employeeCategory.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Employee category code "${input.code}" is already in use.`);

  const category = await HrConfigRepository.employeeCategory.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, isActive: input.isActive ?? true },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_categories",
    recordId: category.id,
    action: "CREATE",
    newValues: category,
  });

  return category;
}

export async function updateEmployeeCategory(actor: ActorContext, id: string, input: EmployeeCategoryInput) {
  const existing = await HrConfigRepository.employeeCategory.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Employee category not found.", { id });

  const updated = await HrConfigRepository.employeeCategory.update({
    where: { id },
    data: { code: input.code, name: input.name, isActive: input.isActive !== undefined ? input.isActive : existing.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_categories",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Shift Master ──────────────────────────────────────────────────────────

export async function listShiftMasters(companyId: string) {
  return HrConfigRepository.shiftMaster.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createShiftMaster(actor: ActorContext, input: ShiftMasterInput) {
  const existing = await HrConfigRepository.shiftMaster.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Shift code "${input.code}" is already in use.`);

  const shift = await HrConfigRepository.shiftMaster.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
      graceMinutes: input.graceMinutes,
      isActive: input.isActive ?? true,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "shift_masters",
    recordId: shift.id,
    action: "CREATE",
    newValues: shift,
  });

  return shift;
}

export async function updateShiftMaster(actor: ActorContext, id: string, input: ShiftMasterInput) {
  const existing = await HrConfigRepository.shiftMaster.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Shift not found.", { id });

  const updated = await HrConfigRepository.shiftMaster.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
      graceMinutes: input.graceMinutes,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "shift_masters",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Holiday Master ────────────────────────────────────────────────────────

export async function listHolidayMasters(companyId: string) {
  return HrConfigRepository.holidayMaster.findMany({ where: { companyId }, orderBy: { date: "asc" } });
}

export async function createHolidayMaster(actor: ActorContext, input: HolidayMasterInput) {
  const existing = await HrConfigRepository.holidayMaster.findFirst({
    where: { companyId: actor.companyId, name: input.name, date: input.date },
  });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Holiday "${input.name}" on this date already exists.`);

  const holiday = await HrConfigRepository.holidayMaster.create({
    data: { companyId: actor.companyId, name: input.name, date: input.date, isActive: input.isActive ?? true },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "holiday_masters",
    recordId: holiday.id,
    action: "CREATE",
    newValues: holiday,
  });

  return holiday;
}

export async function updateHolidayMaster(actor: ActorContext, id: string, input: HolidayMasterInput) {
  const existing = await HrConfigRepository.holidayMaster.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Holiday not found.", { id });

  const updated = await HrConfigRepository.holidayMaster.update({
    where: { id },
    data: { name: input.name, date: input.date, isActive: input.isActive !== undefined ? input.isActive : existing.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "holiday_masters",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

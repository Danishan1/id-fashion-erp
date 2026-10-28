import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { round2 } from "@/lib/money";
import type { EmployeeSalarySetupInput, StatutoryKind, StatutorySettingInput } from "./salary-setup.schema";

/**
 * Salary Management slice 1 (2026-10-28, docs/hrms/SALARY_MANAGEMENT_PLAN.md):
 * PF / ESIC rate masters and the per-employee salary setup the salary run
 * (slice 3) reads. Base salary is mirrored onto Employee.fixedMonthlySalary
 * and the overtime rate lives on EmployeeAttendanceProfile, so neither value
 * has two sources.
 */

export interface SalaryActor {
  companyId: string;
  userId: string;
}

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

// ── PF / ESIC masters ───────────────────────────────────────────

export async function listStatutorySettings(companyId: string, kind: StatutoryKind) {
  return prisma.salaryStatutorySetting.findMany({ where: { companyId, kind }, orderBy: [{ isActive: "desc" }, { title: "asc" }] });
}

async function assertUniqueTitle(companyId: string, kind: StatutoryKind, title: string, exceptId?: string) {
  const clash = await prisma.salaryStatutorySetting.findFirst({
    where: { companyId, kind, title: { equals: title, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new BusinessRuleError("VALIDATION_ERROR", `A ${kind} setting named "${title}" already exists.`);
}

export async function createStatutorySetting(actor: SalaryActor, kind: StatutoryKind, input: StatutorySettingInput) {
  await assertUniqueTitle(actor.companyId, kind, input.title);
  const row = await prisma.salaryStatutorySetting.create({
    data: {
      companyId: actor.companyId,
      kind,
      title: input.title,
      employerRate: input.employerRate,
      employeeRate: input.employeeRate,
      maxLimit: input.maxLimit ?? null,
      isActive: input.isActive ?? true,
    },
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_statutory_settings", recordId: row.id, action: "CREATE", newValues: { kind, ...input } });
  return row;
}

export async function updateStatutorySetting(actor: SalaryActor, kind: StatutoryKind, id: string, input: StatutorySettingInput) {
  const existing = await prisma.salaryStatutorySetting.findFirst({ where: { id, companyId: actor.companyId, kind } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", `${kind} setting not found.`, { id });
  await assertUniqueTitle(actor.companyId, kind, input.title, id);
  const row = await prisma.salaryStatutorySetting.update({
    where: { id },
    data: {
      title: input.title,
      employerRate: input.employerRate,
      employeeRate: input.employeeRate,
      maxLimit: input.maxLimit ?? null,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_salary_statutory_settings",
    recordId: id,
    action: "UPDATE",
    oldValues: { title: existing.title, employerRate: num(existing.employerRate), employeeRate: num(existing.employeeRate), maxLimit: existing.maxLimit === null ? null : num(existing.maxLimit), isActive: existing.isActive },
    newValues: input,
  });
  return row;
}

// ── Employee salary setup ───────────────────────────────────────

export interface SalaryComponentView {
  kind: "ALLOWANCE" | "DEDUCTION";
  title: string;
  amount: number;
}

/** Fixed monthly figures shown on the setup list (before attendance, PF and ESIC). */
export function summarizeSalarySetup(base: number, components: SalaryComponentView[], flat: { tds: number; surcharge: number; educationCess: number; lateFeeInterest: number }) {
  const allowances = round2(components.filter((c) => c.kind === "ALLOWANCE").reduce((s, c) => s + c.amount, 0));
  const deductions = round2(components.filter((c) => c.kind === "DEDUCTION").reduce((s, c) => s + c.amount, 0));
  const taxes = round2(flat.tds + flat.surcharge + flat.educationCess + flat.lateFeeInterest);
  return { base: round2(base), allowances, gross: round2(base + allowances), deductions, taxes };
}

function toComponents(rows: { kind: string; title: string; amount: Prisma.Decimal }[]): SalaryComponentView[] {
  return rows.map((r) => ({ kind: r.kind as SalaryComponentView["kind"], title: r.title, amount: num(r.amount) }));
}

export async function listEmployeeSalarySetups(companyId: string, opts: { search?: string } = {}) {
  const search = opts.search?.trim();
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      deletedAt: null,
      isActive: true,
      ...(search ? { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { employeeCode: { contains: search, mode: "insensitive" } }] } : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      fixedMonthlySalary: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      salarySetting: {
        select: {
          baseMonthlySalary: true,
          tdsAmount: true,
          surchargeAmount: true,
          educationCess: true,
          lateFeeInterest: true,
          updatedAt: true,
          pfSetting: { select: { title: true } },
          esicSetting: { select: { title: true } },
          components: { select: { kind: true, title: true, amount: true } },
        },
      },
    },
    orderBy: { fullName: "asc" },
  });

  return employees.map((e) => {
    const s = e.salarySetting;
    const summary = s
      ? summarizeSalarySetup(num(s.baseMonthlySalary), toComponents(s.components), { tds: num(s.tdsAmount), surcharge: num(s.surchargeAmount), educationCess: num(s.educationCess), lateFeeInterest: num(s.lateFeeInterest) })
      : null;
    return {
      employeeId: e.id,
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      department: e.department?.name ?? null,
      designation: e.designation?.name ?? null,
      configured: Boolean(s),
      base: summary?.base ?? (e.fixedMonthlySalary === null ? null : num(e.fixedMonthlySalary)),
      gross: summary?.gross ?? null,
      fixedDeductions: summary ? round2(summary.deductions + summary.taxes) : null,
      pf: s?.pfSetting?.title ?? null,
      esic: s?.esicSetting?.title ?? null,
      updatedAt: s?.updatedAt ?? null,
    };
  });
}

async function findEmployee(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId, deletedAt: null },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      joinDate: true,
      fixedMonthlySalary: true,
      travelAllowance: true,
      dearnessAllowance: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      attendanceProfile: { select: { overtimeRatePerHour: true } },
      salarySetting: { include: { components: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { employeeId });
  return employee;
}

/** The saved setup, or a prefill from the employee master when none is saved yet. */
export async function getEmployeeSalarySetup(companyId: string, employeeId: string) {
  const e = await findEmployee(companyId, employeeId);
  const s = e.salarySetting;
  const employee = {
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    joinDate: e.joinDate,
    department: e.department?.name ?? null,
    designation: e.designation?.name ?? null,
  };
  const overtimeRatePerHour = e.attendanceProfile?.overtimeRatePerHour == null ? null : num(e.attendanceProfile.overtimeRatePerHour);

  if (!s) {
    const components: SalaryComponentView[] = [];
    if (num(e.travelAllowance) > 0) components.push({ kind: "ALLOWANCE", title: "Travel Allowance", amount: num(e.travelAllowance) });
    if (num(e.dearnessAllowance) > 0) components.push({ kind: "ALLOWANCE", title: "Dearness Allowance", amount: num(e.dearnessAllowance) });
    return {
      employee,
      configured: false,
      setup: {
        baseMonthlySalary: num(e.fixedMonthlySalary),
        pfSettingId: null,
        esicSettingId: null,
        panNumber: null,
        uanNumber: null,
        esicNumber: null,
        tdsAmount: 0,
        surchargeAmount: 0,
        educationCess: 0,
        lateFeeInterest: 0,
        overtimeRatePerHour,
        bankName: null,
        bankAccountNumber: null,
        bankIfsc: null,
        bankBranch: null,
        components,
      },
    };
  }

  return {
    employee,
    configured: true,
    updatedAt: s.updatedAt,
    setup: {
      baseMonthlySalary: num(s.baseMonthlySalary),
      pfSettingId: s.pfSettingId,
      esicSettingId: s.esicSettingId,
      panNumber: s.panNumber,
      uanNumber: s.uanNumber,
      esicNumber: s.esicNumber,
      tdsAmount: num(s.tdsAmount),
      surchargeAmount: num(s.surchargeAmount),
      educationCess: num(s.educationCess),
      lateFeeInterest: num(s.lateFeeInterest),
      overtimeRatePerHour,
      bankName: s.bankName,
      bankAccountNumber: s.bankAccountNumber,
      bankIfsc: s.bankIfsc,
      bankBranch: s.bankBranch,
      components: toComponents(s.components),
    },
  };
}

async function resolveStatutory(companyId: string, kind: StatutoryKind, id: string | undefined, currentId: string | null) {
  if (!id) return null;
  const row = await prisma.salaryStatutorySetting.findFirst({ where: { id, companyId, kind }, select: { id: true, isActive: true, title: true } });
  if (!row) throw new BusinessRuleError("NOT_FOUND", `${kind} setting not found.`, { id });
  // An inactive setting can stay on an employee who already had it, but can't be newly picked.
  if (!row.isActive && row.id !== currentId) throw new BusinessRuleError("VALIDATION_ERROR", `${kind} setting "${row.title}" is inactive.`);
  return row.id;
}

export async function saveEmployeeSalarySetup(actor: SalaryActor, employeeId: string, input: EmployeeSalarySetupInput) {
  const before = await getEmployeeSalarySetup(actor.companyId, employeeId);
  const existing = await prisma.employeeSalarySetting.findUnique({ where: { employeeId }, select: { id: true, pfSettingId: true, esicSettingId: true } });

  const pfSettingId = await resolveStatutory(actor.companyId, "PF", input.pfSettingId || undefined, existing?.pfSettingId ?? null);
  const esicSettingId = await resolveStatutory(actor.companyId, "ESIC", input.esicSettingId || undefined, existing?.esicSettingId ?? null);

  const data = {
    baseMonthlySalary: input.baseMonthlySalary,
    pfSettingId,
    esicSettingId,
    panNumber: input.panNumber || null,
    uanNumber: input.uanNumber || null,
    esicNumber: input.esicNumber || null,
    tdsAmount: input.tdsAmount,
    surchargeAmount: input.surchargeAmount,
    educationCess: input.educationCess,
    lateFeeInterest: input.lateFeeInterest,
    bankName: input.bankName || null,
    bankAccountNumber: input.bankAccountNumber || null,
    bankIfsc: input.bankIfsc || null,
    bankBranch: input.bankBranch || null,
    updatedByUserId: actor.userId,
  };

  await prisma.$transaction(async (tx) => {
    const setting = await tx.employeeSalarySetting.upsert({
      where: { employeeId },
      create: { ...data, companyId: actor.companyId, employeeId, createdByUserId: actor.userId },
      update: data,
      select: { id: true },
    });
    await tx.employeeSalaryComponent.deleteMany({ where: { settingId: setting.id } });
    if (input.components.length > 0) {
      await tx.employeeSalaryComponent.createMany({
        data: input.components.map((c, i) => ({ settingId: setting.id, kind: c.kind, title: c.title, amount: c.amount, sortOrder: i })),
      });
    }
    await tx.employee.update({ where: { id: employeeId }, data: { fixedMonthlySalary: input.baseMonthlySalary } });
    if (input.overtimeRatePerHour !== undefined) {
      await tx.employeeAttendanceProfile.upsert({
        where: { employeeId },
        create: { companyId: actor.companyId, employeeId, overtimeRatePerHour: input.overtimeRatePerHour },
        update: { overtimeRatePerHour: input.overtimeRatePerHour },
      });
    }
  });

  // Bank/PAN are logged as present/absent only, not the numbers themselves.
  const mask = (s: typeof before.setup) => ({
    ...s,
    panNumber: s.panNumber ? "set" : null,
    bankAccountNumber: s.bankAccountNumber ? `••••${s.bankAccountNumber.slice(-4)}` : null,
  });
  const after = await getEmployeeSalarySetup(actor.companyId, employeeId);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_employee_salary_settings",
    recordId: employeeId,
    action: existing ? "UPDATE" : "CREATE",
    oldValues: existing ? mask(before.setup) : undefined,
    newValues: mask(after.setup),
  });
  return after;
}

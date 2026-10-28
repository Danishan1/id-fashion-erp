import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalaryAmounts, SalarySetupSnapshot } from "./salary-calculator";

/**
 * Salary Management slice 4 (2026-10-28): Salary History. Only FINALISED
 * runs, read-only, straight from the stored lines (never recalculated — the
 * reference's history page re-ran payroll on every load). With view_all you
 * see everyone; without it only your own slips (a manager does NOT see the
 * team's salaries, unlike the attendance screens).
 */

const MODULE = "hrms_salary_history" as const;

export interface SalaryHistoryActor {
  companyId: string;
  userId: string;
}

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** null = everyone; otherwise the only employee id the caller may see (or none). */
async function historyScope(actor: SalaryHistoryActor): Promise<string[] | null> {
  if (await PermissionService.can(actor.userId, MODULE, "view_all")) return null;
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  return user?.employeeId ? [user.employeeId] : [];
}

export async function listSalaryHistory(actor: SalaryHistoryActor, year?: number) {
  const scope = await historyScope(actor);
  const runs = await prisma.salaryRun.findMany({
    where: { companyId: actor.companyId, status: "FINALISED", ...(year ? { year } : {}) },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: {
      id: true,
      year: true,
      month: true,
      finalisedAt: true,
      lines: {
        where: scope === null ? {} : { employeeId: { in: scope } },
        orderBy: { employeeName: "asc" },
        select: { id: true, employeeId: true, employeeCode: true, employeeName: true, calendarDays: true, grossAmount: true, totalDeductions: true, arrearsAmount: true, netAmount: true, amountsJson: true },
      },
    },
  });
  return {
    canSeeAll: scope === null,
    runs: runs
      .filter((r) => r.lines.length > 0)
      .map((r) => ({
        id: r.id,
        year: r.year,
        month: r.month,
        finalisedAt: r.finalisedAt,
        totalNet: r.lines.reduce((s, l) => s + num(l.netAmount), 0),
        lines: r.lines.map((l) => {
          const a = l.amountsJson as unknown as SalaryAmounts;
          return {
            id: l.id,
            employeeId: l.employeeId,
            employeeCode: l.employeeCode,
            employeeName: l.employeeName,
            paidDays: a.paidDays,
            calendarDays: l.calendarDays,
            gross: num(l.grossAmount),
            deductions: num(l.totalDeductions),
            arrears: num(l.arrearsAmount),
            net: num(l.netAmount),
          };
        }),
      })),
  };
}

/** Everything the slip PDF needs, for a line the caller may see. */
export async function getSalarySlipData(actor: SalaryHistoryActor, lineId: string) {
  const scope = await historyScope(actor);
  const line = await prisma.salaryRunLine.findFirst({
    where: { id: lineId, run: { companyId: actor.companyId, status: "FINALISED" }, ...(scope === null ? {} : { employeeId: { in: scope } }) },
    include: {
      run: { select: { year: true, month: true, finalisedAt: true } },
      employee: { select: { joinDate: true, department: { select: { name: true } }, designation: { select: { name: true } }, email: true } },
    },
  });
  if (!line) throw new BusinessRuleError("NOT_FOUND", "Salary slip not found.", { id: lineId });
  const company = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { name: true, legalName: true, addressJson: true } });
  const setup = line.setupJson as unknown as SalarySetupSnapshot;
  const a = line.amountsJson as unknown as SalaryAmounts;
  const days = {
    present: line.presentDays === null ? num(line.systemPresentDays) : num(line.presentDays),
    paidLeave: line.paidLeaveDays === null ? num(line.systemPaidLeaveDays) : num(line.paidLeaveDays),
    extra: line.extraDays === null ? num(line.systemExtraDays) : num(line.extraDays),
  };
  return {
    company: {
      name: company?.legalName || company?.name || "",
      address: (company?.addressJson as { line1?: string } | null)?.line1 ?? null,
    },
    year: line.run.year,
    month: line.run.month,
    employee: {
      code: line.employeeCode,
      name: line.employeeName,
      designation: line.employee.designation?.name ?? null,
      department: line.employee.department?.name ?? null,
      joinDate: line.employee.joinDate,
      email: line.employee.email,
      pan: setup.panNumber,
      uan: setup.uanNumber,
      esicNumber: setup.esicNumber,
      bankName: setup.bankName,
      bankAccount: setup.bankAccountNumber,
      bankIfsc: setup.bankIfsc,
    },
    days: {
      calendar: line.calendarDays,
      present: days.present,
      weekend: num(line.weekendDays),
      holiday: num(line.holidayDays),
      paidLeave: days.paidLeave,
      unpaidAndAbsent: Math.max(0, Math.round((line.calendarDays - a.paidDays) * 100) / 100),
      extra: days.extra,
      overtimeHours: num(line.overtimeHours),
      paid: a.paidDays,
    },
    setup,
    amounts: a,
    arrearsReason: line.arrearsReason,
  };
}
export type SalarySlipData = Awaited<ReturnType<typeof getSalarySlipData>>;

/** Lines of one finalised run, for the Excel report (needs company-wide view). */
export async function getRunForExport(actor: SalaryHistoryActor, runId: string) {
  const scope = await historyScope(actor);
  if (scope !== null) throw new BusinessRuleError("PERMISSION_DENIED", "The salary report needs company-wide access (view all).");
  const run = await prisma.salaryRun.findFirst({
    where: { id: runId, companyId: actor.companyId, status: "FINALISED" },
    include: { lines: { orderBy: { employeeName: "asc" } } },
  });
  if (!run) throw new BusinessRuleError("NOT_FOUND", "Salary run not found.", { id: runId });
  return run;
}

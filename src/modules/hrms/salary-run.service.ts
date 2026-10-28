import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { istDateKey, monthDateKeys, round2 } from "./attendance-calculator";
import { countPendingRegularizations } from "./attendance-correction.service";
import { computeEmployeesMonth, type EmployeeMonth } from "./attendance-month.service";
import { getHrmsEmployeeScope } from "./hrms-scope";
import { cascadeAvailability, ensureBalance } from "./leave-balance.service";
import { summarizeSalaryMonth } from "./salary-attendance.service";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { advanceInstallmentsFor } from "./salary-advance.service";
import { salaryRequestsForRun, undoSendToAccountsInTx } from "./salary-payout.service";
import { computeSalary, type SalaryAmounts, type SalarySetupSnapshot } from "./salary-calculator";
import type { EditSalaryLineInput } from "./salary-run.schema";

/**
 * Salary Management slice 3 (2026-10-28, docs/hrms/SALARY_MANAGEMENT_PLAN.md):
 * Generate Salary. One run per company-month:
 *   DRAFT (generate / regenerate / edit lines) → APPROVED (maker-checker) →
 *   FINALISED (spends auto paid leave, month locked) — Send back / Reopen go
 *   back to DRAFT with a reason. Lines keep the system figures and the edited
 *   Present / Paid Leave / Extra Days / Arrears separately; edits never touch
 *   attendance. Formula: salary-calculator.ts (reference project, unchanged).
 */

const MODULE = "hrms_salary_generate" as const;

export interface SalaryRunActor {
  companyId: string;
  userId: string;
  /** Journals use the actor's branch number series, like every other posting. */
  branchId?: string | null;
}

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function assertCompanyWide(actor: SalaryRunActor) {
  const scope = await getHrmsEmployeeScope(actor.userId, MODULE);
  if (scope !== null) throw new BusinessRuleError("PERMISSION_DENIED", "Salary runs need company-wide access (view all).");
}

async function logEvent(tx: Prisma.TransactionClient, runId: string, action: string, userId: string, reason?: string | null) {
  await tx.salaryRunEvent.create({ data: { runId, action, userId, reason: reason ?? null } });
}

// ── Inputs ──────────────────────────────────────────────────────

async function loadSetups(companyId: string) {
  const settings = await prisma.employeeSalarySetting.findMany({
    where: { companyId, employee: { deletedAt: null, isActive: true } },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      pfSetting: true,
      esicSetting: true,
      employee: { select: { attendanceProfile: { select: { overtimeRatePerHour: true } } } },
    },
  });
  const map = new Map<string, SalarySetupSnapshot>();
  for (const s of settings) {
    const statutory = (row: typeof s.pfSetting) =>
      row ? { title: row.title, employeeRate: num(row.employeeRate), employerRate: num(row.employerRate), maxLimit: numOrNull(row.maxLimit) } : null;
    map.set(s.employeeId, {
      baseMonthlySalary: num(s.baseMonthlySalary),
      components: s.components.map((c) => ({ kind: c.kind, title: c.title, amount: num(c.amount) })),
      pf: statutory(s.pfSetting),
      esic: statutory(s.esicSetting),
      tdsAmount: num(s.tdsAmount),
      surchargeAmount: num(s.surchargeAmount),
      educationCess: num(s.educationCess),
      lateFeeInterest: num(s.lateFeeInterest),
      overtimeRatePerHour: num(s.employee.attendanceProfile?.overtimeRatePerHour),
      panNumber: s.panNumber,
      uanNumber: s.uanNumber,
      esicNumber: s.esicNumber,
      bankName: s.bankName,
      bankAccountNumber: s.bankAccountNumber,
      bankIfsc: s.bankIfsc,
      bankBranch: s.bankBranch,
    });
  }
  return map;
}

/** Leave left this month (remaining + carry-forward, all active types) — for auto paid leave. */
async function availableLeave(companyId: string, employeeIds: string[], year: number, month: number) {
  const types = await prisma.leaveType.findMany({ where: { companyId, isActive: true }, select: { id: true } });
  const map = new Map<string, number>();
  for (const id of employeeIds) {
    let total = 0;
    for (const t of types) {
      const b = await prisma.$transaction((tx) => ensureBalance(tx, companyId, id, t.id, year, month));
      total += num(b.remaining) + num(b.carryForward);
    }
    map.set(id, round2(total));
  }
  return map;
}

/** System figures for one employee-month (salary adjustments applied). */
export function systemFigures(m: EmployeeMonth, availableLeaveDays: number) {
  const s = m.summary;
  const autoPaid = round2(Math.min(s.zeroHourWorkdays, Math.max(0, availableLeaveDays), s.absentDays));
  const counted = m.days.filter((d) => !d.isFuture && !d.isPreJoining);
  return {
    calendarDays: s.calendarDays,
    presentDays: s.presentDays,
    paidLeaveDays: round2(s.paidLeaveDays + autoPaid),
    autoPaidLeaveDays: autoPaid,
    unpaidLeaveDays: s.unpaidLeaveDays,
    absentDays: round2(s.absentDays - autoPaid),
    weekendDays: s.weekendDays,
    holidayDays: s.holidayDays,
    extraDays: s.extraPayableDays,
    overtimeHours: s.approvedOvertimeHours,
    attendancePercent: summarizeSalaryMonth(m).hoursPercent,
    hasNoPunches: counted.every((d) => d.actualWorkedHours <= 0),
  };
}

type LineRow = Prisma.SalaryRunLineGetPayload<object>;

function effective(line: LineRow) {
  return {
    presentDays: line.presentDays === null ? num(line.systemPresentDays) : num(line.presentDays),
    paidLeaveDays: line.paidLeaveDays === null ? num(line.systemPaidLeaveDays) : num(line.paidLeaveDays),
    extraDays: line.extraDays === null ? num(line.systemExtraDays) : num(line.extraDays),
  };
}

interface LineInputs {
  setup: SalarySetupSnapshot;
  calendarDays: number;
  weekendDays: number;
  holidayDays: number;
  overtimeHours: number;
  arrears: number;
  /** Advance salary installments due this month (slice 5). */
  installment: number;
  hasNoPunches: boolean;
}

function inputsOf(line: LineRow, arrears = num(line.arrearsAmount)): LineInputs {
  return {
    setup: line.setupJson as unknown as SalarySetupSnapshot,
    calendarDays: line.calendarDays,
    weekendDays: num(line.weekendDays),
    holidayDays: num(line.holidayDays),
    overtimeHours: num(line.overtimeHours),
    arrears,
    installment: num(line.installmentAmount),
    hasNoPunches: line.hasNoPunches,
  };
}

function amountsFor(i: LineInputs, eff: ReturnType<typeof effective>): SalaryAmounts {
  return computeSalary({
    setup: i.setup,
    days: { calendarDays: i.calendarDays, presentDays: eff.presentDays, weekendDays: i.weekendDays, holidayDays: i.holidayDays, paidLeaveDays: eff.paidLeaveDays, extraDays: eff.extraDays },
    overtimeHours: i.overtimeHours,
    arrears: i.arrears,
    installment: i.installment,
    hasNoPunches: i.hasNoPunches,
  });
}

function amountColumns(a: SalaryAmounts) {
  return {
    amountsJson: a as unknown as Prisma.InputJsonValue,
    grossAmount: round2(a.earnedGross + a.arrears),
    totalDeductions: a.totalDeductions,
    netAmount: a.net,
  };
}

async function refreshTotals(tx: Prisma.TransactionClient, runId: string) {
  const agg = await tx.salaryRunLine.aggregate({ where: { runId }, _sum: { grossAmount: true, totalDeductions: true, netAmount: true } });
  await tx.salaryRun.update({
    where: { id: runId },
    data: { totalGross: num(agg._sum.grossAmount), totalDeductions: num(agg._sum.totalDeductions), totalNet: num(agg._sum.netAmount) },
  });
}

// ── Read ────────────────────────────────────────────────────────

export async function getSalaryRunView(actor: SalaryRunActor, year: number, month: number) {
  await assertCompanyWide(actor);
  const keys = monthDateKeys(year, month);
  const monthEnded = keys[keys.length - 1] < istDateKey(new Date());
  const [run, oldClose, pendingRegularizations, employees, setups] = await Promise.all([
    prisma.salaryRun.findUnique({
      where: { companyId_year_month: { companyId: actor.companyId, year, month } },
      include: {
        lines: { orderBy: { employeeName: "asc" }, include: { edits: { orderBy: { createdAt: "desc" } } } },
        events: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.attendanceMonthClose.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } }, select: { id: true } }),
    countPendingRegularizations(actor.companyId, null),
    prisma.employee.findMany({ where: { companyId: actor.companyId, deletedAt: null, isActive: true }, select: { id: true, employeeCode: true, fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.employeeSalarySetting.findMany({ where: { companyId: actor.companyId }, select: { employeeId: true } }),
  ]);
  const withSetup = new Set(setups.map((s) => s.employeeId));
  const missingSetup = employees.filter((e) => !withSetup.has(e.id)).map((e) => ({ id: e.id, employeeCode: e.employeeCode, fullName: e.fullName }));

  const userIds = new Set<string>();
  if (run) {
    [run.generatedByUserId, run.approvedByUserId, run.finalisedByUserId].forEach((id) => id && userIds.add(id));
    run.events.forEach((e) => userIds.add(e.userId));
    run.lines.forEach((l) => l.edits.forEach((e) => userIds.add(e.editedByUserId)));
  }
  if (run?.sentToAccountsByUserId) userIds.add(run.sentToAccountsByUserId);
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } }) : [];
  const name = (id: string | null | undefined) => (id ? users.find((u) => u.id === id)?.fullName ?? "—" : null);
  const requests = run?.sentToAccountsAt ? await salaryRequestsForRun(actor.companyId, run.lines.map((l) => l.id)) : [];
  const requestByLine = new Map(requests.map((r) => [r.sourceRecordId, r]));

  return {
    year,
    month,
    monthEnded,
    oldSheetFinalised: Boolean(oldClose),
    pendingRegularizations,
    missingSetup,
    run: run && {
      id: run.id,
      status: run.status,
      generatedAt: run.generatedAt,
      generatedBy: name(run.generatedByUserId),
      generatedByUserId: run.generatedByUserId,
      approvedAt: run.approvedAt,
      approvedBy: name(run.approvedByUserId),
      finalisedAt: run.finalisedAt,
      finalisedBy: name(run.finalisedByUserId),
      sentToAccountsAt: run.sentToAccountsAt,
      sentToAccountsBy: name(run.sentToAccountsByUserId),
      accrualJournalId: run.accrualJournalId,
      paidCount: requests.filter((r) => r.status === "PAID").length,
      totals: { gross: num(run.totalGross), deductions: num(run.totalDeductions), net: num(run.totalNet) },
      events: run.events.map((e) => ({ action: e.action, reason: e.reason, at: e.createdAt, by: name(e.userId) })),
      lines: run.lines.map((l) => {
        const eff = effective(l);
        return {
          id: l.id,
          employeeId: l.employeeId,
          employeeCode: l.employeeCode,
          employeeName: l.employeeName,
          calendarDays: l.calendarDays,
          system: { presentDays: num(l.systemPresentDays), paidLeaveDays: num(l.systemPaidLeaveDays), extraDays: num(l.systemExtraDays) },
          presentDays: eff.presentDays,
          paidLeaveDays: eff.paidLeaveDays,
          extraDays: eff.extraDays,
          autoPaidLeaveDays: num(l.autoPaidLeaveDays),
          unpaidLeaveDays: num(l.unpaidLeaveDays),
          // After an edit, absent is whatever the edited days leave uncovered.
          absentDays: l.presentDays === null && l.paidLeaveDays === null
            ? num(l.absentDays)
            : Math.max(0, round2(l.calendarDays - eff.presentDays - eff.paidLeaveDays - num(l.unpaidLeaveDays) - num(l.weekendDays) - num(l.holidayDays))),
          weekendDays: num(l.weekendDays),
          holidayDays: num(l.holidayDays),
          overtimeHours: num(l.overtimeHours),
          installmentAmount: num(l.installmentAmount),
          attendancePercent: num(l.attendancePercent),
          hasNoPunches: l.hasNoPunches,
          arrearsAmount: num(l.arrearsAmount),
          arrearsReason: l.arrearsReason,
          edited: l.presentDays !== null || l.paidLeaveDays !== null || l.extraDays !== null || num(l.arrearsAmount) !== 0,
          amounts: l.amountsJson as unknown as SalaryAmounts,
          grossAmount: num(l.grossAmount),
          totalDeductions: num(l.totalDeductions),
          netAmount: num(l.netAmount),
          edits: l.edits.map((e) => ({ field: e.field, oldValue: e.oldValue, newValue: e.newValue, reason: e.reason, at: e.createdAt, by: name(e.editedByUserId) })),
          paymentRequest: (() => {
            const r = requestByLine.get(l.id);
            return r ? { id: r.id, requestNumber: r.requestNumber, status: r.status, paidAmount: num(r.paidAmount) } : null;
          })(),
        };
      }),
    },
  };
}

/** Attendance summary before any run exists (and the source of the first generation). */
export async function previewAttendanceSummary(actor: SalaryRunActor, year: number, month: number) {
  await assertCompanyWide(actor);
  const setups = await loadSetups(actor.companyId);
  const ids = [...setups.keys()];
  const [months, leave] = await Promise.all([
    computeEmployeesMonth(actor.companyId, ids, year, month, new Date(), { applySalaryAdjustments: true }),
    availableLeave(actor.companyId, ids, year, month),
  ]);
  return months.map((m) => {
    const f = systemFigures(m, leave.get(m.employee.id) ?? 0);
    return { employeeId: m.employee.id, employeeCode: m.employee.employeeCode, fullName: m.employee.fullName, ...f };
  });
}

// ── Generate ────────────────────────────────────────────────────

export async function generateSalaryRun(actor: SalaryRunActor, year: number, month: number) {
  await assertCompanyWide(actor);
  const keys = monthDateKeys(year, month);
  if (keys[keys.length - 1] >= istDateKey(new Date())) throw new BusinessRuleError("VALIDATION_ERROR", "Salary can be generated only after the month has ended.");
  const oldClose = await prisma.attendanceMonthClose.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } }, select: { id: true } });
  if (oldClose) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `${monthLabel(year, month)} was already finalised on the old Salary Sheet.`);
  const pending = await countPendingRegularizations(actor.companyId, null);
  if (pending > 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `${pending} regularization request(s) are still pending — approve or reject them first.`);
  const existing = await prisma.salaryRun.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } }, include: { lines: true } });
  if (existing && existing.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Salary for ${monthLabel(year, month)} is ${existing.status.toLowerCase()} — it can't be regenerated.`);

  const setups = await loadSetups(actor.companyId);
  if (setups.size === 0) throw new BusinessRuleError("VALIDATION_ERROR", "No employee has a salary setup yet — set them up under Salary Setup first.");
  const ids = [...setups.keys()];
  const [months, leave, installments] = await Promise.all([
    computeEmployeesMonth(actor.companyId, ids, year, month, new Date(), { applySalaryAdjustments: true }),
    availableLeave(actor.companyId, ids, year, month),
    advanceInstallmentsFor(actor.companyId, ids),
  ]);
  const previous = new Map((existing?.lines ?? []).map((l) => [l.employeeId, l]));

  const run = await prisma.$transaction(async (tx) => {
    const runRow = existing
      ? await tx.salaryRun.update({ where: { id: existing.id }, data: { generatedByUserId: actor.userId, generatedAt: new Date(), sentBackReason: null } })
      : await tx.salaryRun.create({ data: { companyId: actor.companyId, year, month, generatedByUserId: actor.userId } });

    for (const m of months) {
      const setup = setups.get(m.employee.id)!;
      const f = systemFigures(m, leave.get(m.employee.id) ?? 0);
      const prev = previous.get(m.employee.id);
      const base = {
        employeeCode: m.employee.employeeCode,
        employeeName: m.employee.fullName,
        setupJson: setup as unknown as Prisma.InputJsonValue,
        calendarDays: f.calendarDays,
        systemPresentDays: f.presentDays,
        systemPaidLeaveDays: f.paidLeaveDays,
        autoPaidLeaveDays: f.autoPaidLeaveDays,
        unpaidLeaveDays: f.unpaidLeaveDays,
        absentDays: f.absentDays,
        weekendDays: f.weekendDays,
        holidayDays: f.holidayDays,
        systemExtraDays: f.extraDays,
        overtimeHours: f.overtimeHours,
        attendancePercent: f.attendancePercent,
        hasNoPunches: f.hasNoPunches,
        installmentAmount: installments.get(m.employee.id)?.total ?? 0,
        installmentJson: (installments.get(m.employee.id)?.items ?? []) as unknown as Prisma.InputJsonValue,
      };
      // Regenerating keeps what the employer already edited (present / paid leave / extra / arrears).
      const kept = {
        presentDays: prev?.presentDays ?? null,
        paidLeaveDays: prev?.paidLeaveDays ?? null,
        extraDays: prev?.extraDays ?? null,
        arrearsAmount: prev?.arrearsAmount ?? 0,
        arrearsReason: prev?.arrearsReason ?? null,
      };
      const eff = {
        presentDays: kept.presentDays === null ? f.presentDays : num(kept.presentDays),
        paidLeaveDays: kept.paidLeaveDays === null ? f.paidLeaveDays : num(kept.paidLeaveDays),
        extraDays: kept.extraDays === null ? f.extraDays : num(kept.extraDays),
      };
      const amounts = amountsFor(
        {
          setup,
          calendarDays: f.calendarDays,
          weekendDays: f.weekendDays,
          holidayDays: f.holidayDays,
          overtimeHours: f.overtimeHours,
          arrears: num(kept.arrearsAmount),
          installment: base.installmentAmount,
          hasNoPunches: f.hasNoPunches,
        },
        eff
      );
      const data = { ...base, ...kept, ...amountColumns(amounts) };
      if (prev) await tx.salaryRunLine.update({ where: { id: prev.id }, data });
      else await tx.salaryRunLine.create({ data: { ...data, runId: runRow.id, employeeId: m.employee.id } });
    }
    // Employees who no longer have a setup drop out of the run.
    await tx.salaryRunLine.deleteMany({ where: { runId: runRow.id, employeeId: { notIn: ids } } });
    await refreshTotals(tx, runRow.id);
    await logEvent(tx, runRow.id, existing ? "REGENERATED" : "GENERATED", actor.userId);
    return runRow;
  });

  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_runs", recordId: run.id, action: existing ? "UPDATE" : "CREATE", newValues: { year, month, employees: months.length } });
  return getSalaryRunView(actor, year, month);
}

// ── Edit a line (DRAFT only) ────────────────────────────────────

export async function editSalaryLine(actor: SalaryRunActor, lineId: string, input: EditSalaryLineInput) {
  await assertCompanyWide(actor);
  const line = await prisma.salaryRunLine.findFirst({ where: { id: lineId, run: { companyId: actor.companyId } }, include: { run: true } });
  if (!line) throw new BusinessRuleError("NOT_FOUND", "Salary line not found.", { id: lineId });
  if (line.run.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft salary can be edited — send it back first.");

  const eff = effective(line);
  const next = {
    presentDays: input.presentDays ?? eff.presentDays,
    paidLeaveDays: input.paidLeaveDays ?? eff.paidLeaveDays,
    extraDays: input.extraDays ?? eff.extraDays,
    arrearsAmount: input.arrearsAmount ?? num(line.arrearsAmount),
  };
  const offDays = num(line.weekendDays) + num(line.holidayDays);
  if (round2(next.presentDays + next.paidLeaveDays + offDays) > line.calendarDays + 1e-9) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Present + paid leave + weekly offs/holidays can't be more than the ${line.calendarDays} days in the month.`);
  }
  if (next.arrearsAmount !== 0 && !(input.arrearsReason ?? line.arrearsReason)?.trim()) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Give a reason for the arrears.");
  }

  const changes: { field: string; oldValue: string; newValue: string }[] = [];
  const track = (field: string, oldV: number, newV: number) => {
    if (Math.abs(oldV - newV) > 1e-9) changes.push({ field, oldValue: String(oldV), newValue: String(newV) });
  };
  track("presentDays", eff.presentDays, next.presentDays);
  track("paidLeaveDays", eff.paidLeaveDays, next.paidLeaveDays);
  track("extraDays", eff.extraDays, next.extraDays);
  track("arrearsAmount", num(line.arrearsAmount), next.arrearsAmount);
  if (changes.length === 0 && (input.arrearsReason ?? line.arrearsReason) === line.arrearsReason) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Nothing changed.");
  }

  // A value equal to the system figure is stored as "not edited".
  const keep = (v: number, system: Prisma.Decimal) => (Math.abs(v - num(system)) < 1e-9 ? null : v);
  const stored = {
    presentDays: keep(next.presentDays, line.systemPresentDays),
    paidLeaveDays: keep(next.paidLeaveDays, line.systemPaidLeaveDays),
    extraDays: keep(next.extraDays, line.systemExtraDays),
    arrearsAmount: next.arrearsAmount,
    arrearsReason: next.arrearsAmount === 0 ? null : (input.arrearsReason ?? line.arrearsReason)?.trim() || null,
  };
  const amounts = amountsFor(inputsOf(line, next.arrearsAmount), { presentDays: next.presentDays, paidLeaveDays: next.paidLeaveDays, extraDays: next.extraDays });

  await prisma.$transaction(async (tx) => {
    const res = await tx.salaryRunLine.updateMany({
      where: { id: line.id, run: { status: "DRAFT" } },
      data: { ...stored, ...amountColumns(amounts) },
    });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The salary run changed — reload and try again.");
    if (changes.length) {
      await tx.salaryRunLineEdit.createMany({ data: changes.map((c) => ({ lineId: line.id, ...c, reason: input.reason, editedByUserId: actor.userId })) });
    }
    await refreshTotals(tx, line.runId);
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_run_lines", recordId: line.id, action: "UPDATE", oldValues: { ...eff, arrearsAmount: num(line.arrearsAmount) }, newValues: { ...next, reason: input.reason } });
  return getSalaryRunView(actor, line.run.year, line.run.month);
}

// ── Lifecycle ───────────────────────────────────────────────────

async function findRun(actor: SalaryRunActor, runId: string) {
  const run = await prisma.salaryRun.findFirst({ where: { id: runId, companyId: actor.companyId } });
  if (!run) throw new BusinessRuleError("NOT_FOUND", "Salary run not found.", { id: runId });
  return run;
}

async function transition(runId: string, from: "DRAFT" | "APPROVED" | "FINALISED", data: Prisma.SalaryRunUpdateManyMutationInput, tx: Prisma.TransactionClient) {
  const res = await tx.salaryRun.updateMany({ where: { id: runId, status: from }, data });
  if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The salary run changed — reload and try again.");
}

/** Maker-checker: the person who generated or edited the run can't approve it (Super Admin exempt). */
export async function approveSalaryRun(actor: SalaryRunActor, runId: string) {
  await assertCompanyWide(actor);
  const run = await findRun(actor, runId);
  if (run.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This salary is already ${run.status.toLowerCase()}.`);
  await PermissionService.assert(actor.userId, MODULE, "approve", { createdBy: run.generatedByUserId });
  const editedByActor = await prisma.salaryRunLineEdit.count({ where: { editedByUserId: actor.userId, line: { runId } } });
  if (editedByActor > 0) await PermissionService.assert(actor.userId, MODULE, "approve", { createdBy: actor.userId });

  await prisma.$transaction(async (tx) => {
    await transition(runId, "DRAFT", { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date() }, tx);
    await logEvent(tx, runId, "APPROVED", actor.userId);
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_runs", recordId: runId, action: "APPROVE", newValues: { year: run.year, month: run.month } });
  return getSalaryRunView(actor, run.year, run.month);
}

export async function sendBackSalaryRun(actor: SalaryRunActor, runId: string, reason: string) {
  await assertCompanyWide(actor);
  const run = await findRun(actor, runId);
  if (run.status !== "APPROVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an approved salary can be sent back.");
  await prisma.$transaction(async (tx) => {
    await transition(runId, "APPROVED", { status: "DRAFT", approvedByUserId: null, approvedAt: null, sentBackReason: reason }, tx);
    await logEvent(tx, runId, "SENT_BACK", actor.userId, reason);
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_runs", recordId: runId, action: "REJECT", newValues: { reason } });
  return getSalaryRunView(actor, run.year, run.month);
}

/** Spend each line's auto paid leave from the balance (this month's remaining first, then carry-forward). */
async function spendAutoLeave(tx: Prisma.TransactionClient, companyId: string, userId: string, line: { id: string; employeeId: string; autoPaidLeaveDays: Prisma.Decimal }, year: number, month: number) {
  let need = num(line.autoPaidLeaveDays);
  const spent: { leaveTypeId: string; balanceId: string; fromRemaining: number; fromCarry: number }[] = [];
  if (need > 0) {
    const balances = await tx.leaveBalance.findMany({ where: { employeeId: line.employeeId, year, month, leaveType: { isActive: true } }, orderBy: { leaveType: { name: "asc" } } });
    for (const b of balances) {
      if (need <= 0) break;
      const available = num(b.remaining) + num(b.carryForward);
      if (available <= 0) continue;
      const take = round2(Math.min(need, available));
      const fromRemaining = round2(Math.min(num(b.remaining), take));
      const fromCarry = round2(take - fromRemaining);
      await tx.leaveBalance.update({ where: { id: b.id }, data: { remaining: { decrement: fromRemaining }, carryForward: { decrement: fromCarry }, used: { increment: take } } });
      await cascadeAvailability(tx, line.employeeId, b.leaveTypeId, year, month, -take);
      await tx.autoLeaveHistory.upsert({
        where: { employeeId_leaveTypeId_year_month: { employeeId: line.employeeId, leaveTypeId: b.leaveTypeId, year, month } },
        create: { companyId, employeeId: line.employeeId, leaveTypeId: b.leaveTypeId, year, month, used: take, preRemaining: available, createdByUserId: userId },
        update: { used: take, preRemaining: available },
      });
      spent.push({ leaveTypeId: b.leaveTypeId, balanceId: b.id, fromRemaining, fromCarry });
      need = round2(need - take);
    }
  }
  await tx.salaryRunLine.update({ where: { id: line.id }, data: { leaveSpendJson: spent as unknown as Prisma.InputJsonValue } });
}

export async function finaliseSalaryRun(actor: SalaryRunActor, runId: string) {
  await assertCompanyWide(actor);
  const run = await findRun(actor, runId);
  if (run.status !== "APPROVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an approved salary can be finalised.");
  await PermissionService.assert(actor.userId, MODULE, "post");
  const lines = await prisma.salaryRunLine.findMany({ where: { runId }, select: { id: true, employeeId: true, autoPaidLeaveDays: true, installmentJson: true, amountsJson: true } });
  await prisma.$transaction(
    async (tx) => {
      await transition(runId, "APPROVED", { status: "FINALISED", finalisedByUserId: actor.userId, finalisedAt: new Date() }, tx);
      for (const line of lines) {
        await spendAutoLeave(tx, actor.companyId, actor.userId, line, run.year, run.month);
        // Advance installments actually deducted (none in a month with no punches) become recoveries.
        const deducted = (line.amountsJson as unknown as SalaryAmounts).installment;
        const items = (line.installmentJson as unknown as { advanceId: string; amount: number }[] | null) ?? [];
        if (deducted > 0 && items.length > 0) {
          await tx.salaryAdvanceRecovery.createMany({ data: items.map((i) => ({ advanceId: i.advanceId, runLineId: line.id, amount: i.amount })), skipDuplicates: true });
        }
      }
      await logEvent(tx, runId, "FINALISED", actor.userId);
    },
    { timeout: 60_000 }
  );
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_runs", recordId: runId, action: "POST", newValues: { year: run.year, month: run.month, employees: lines.length } });
  return getSalaryRunView(actor, run.year, run.month);
}

/** Back to DRAFT: gives the auto paid leave back and unlocks the month. */
export async function reopenSalaryRun(actor: SalaryRunActor, runId: string, reason: string) {
  await assertCompanyWide(actor);
  const run = await findRun(actor, runId);
  if (run.status !== "FINALISED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a finalised salary can be reopened.");
  const lines = await prisma.salaryRunLine.findMany({ where: { runId }, select: { id: true, employeeId: true, leaveSpendJson: true } });
  // Sent to Accounts: the accrual is reversed (number drawn outside the transaction, like every journal).
  const reversalNumber = run.accrualJournalId ? await generateDocumentNumber({ companyId: actor.companyId, branchId: actor.branchId ?? null, documentType: "JOURNAL" }) : null;
  await prisma.$transaction(
    async (tx) => {
      if (run.sentToAccountsAt) await undoSendToAccountsInTx(tx, actor, run, lines.map((l) => l.id), reversalNumber);
      await transition(runId, "FINALISED", { status: "DRAFT", approvedByUserId: null, approvedAt: null, finalisedByUserId: null, finalisedAt: null, reopenReason: reason }, tx);
      for (const line of lines) {
        const spent = (line.leaveSpendJson as unknown as { leaveTypeId: string; balanceId: string; fromRemaining: number; fromCarry: number }[] | null) ?? [];
        for (const s of spent) {
          const take = round2(s.fromRemaining + s.fromCarry);
          await tx.leaveBalance.update({ where: { id: s.balanceId }, data: { remaining: { increment: s.fromRemaining }, carryForward: { increment: s.fromCarry }, used: { decrement: take } } });
          await cascadeAvailability(tx, line.employeeId, s.leaveTypeId, run.year, run.month, take);
          await tx.autoLeaveHistory.deleteMany({ where: { employeeId: line.employeeId, leaveTypeId: s.leaveTypeId, year: run.year, month: run.month } });
        }
        await tx.salaryRunLine.update({ where: { id: line.id }, data: { leaveSpendJson: Prisma.DbNull } });
      }
      // The month's advance installments are no longer recovered.
      await tx.salaryAdvanceRecovery.deleteMany({ where: { runLine: { runId } } });
      await logEvent(tx, runId, "REOPENED", actor.userId, reason);
    },
    { timeout: 60_000 }
  );
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_runs", recordId: runId, action: "CANCEL", newValues: { reason } });
  return getSalaryRunView(actor, run.year, run.month);
}

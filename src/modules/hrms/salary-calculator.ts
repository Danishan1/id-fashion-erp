/**
 * Salary Management slice 3 (2026-10-28): the reference project's salary
 * formula (indradhar internal_project salary.js / salaryHelpers.computeNetSalary),
 * kept as-is. Pure — no database — so the run service and the tests share it.
 *
 *   perDay        = (base + allowances) / daysInMonth
 *   overtimePay   = overtimeRate × approved overtime hours
 *   pf            = employee PF% × base                 (capped at the PF wage ceiling when one is set)
 *   esic          = employee ESIC% × (base + allowances) (capped at the ESIC wage ceiling when one is set)
 *   gross         = base + allowances + overtimePay
 *   paidDays      = present + weekly offs + holidays + paid leave + extra days
 *   earnedGross   = round(gross / daysInMonth × paidDays)
 *   deductions    = fixed deductions + pf + esic
 *   net           = max(0, round(earnedGross + arrears − (deductions + installment + tds + surcharge + cess + late-fee interest)))
 *
 * With no punches at all in the month, PF, ESIC, fixed deductions and the
 * advance installment are 0 (same as the reference).
 */

export interface SalarySetupSnapshot {
  baseMonthlySalary: number;
  components: { kind: "ALLOWANCE" | "DEDUCTION"; title: string; amount: number }[];
  pf: { title: string; employeeRate: number; employerRate: number; maxLimit: number | null } | null;
  esic: { title: string; employeeRate: number; employerRate: number; maxLimit: number | null } | null;
  tdsAmount: number;
  surchargeAmount: number;
  educationCess: number;
  lateFeeInterest: number;
  overtimeRatePerHour: number;
  panNumber: string | null;
  uanNumber: string | null;
  esicNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
}

export interface SalaryDays {
  calendarDays: number;
  presentDays: number;
  weekendDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  extraDays: number;
}

export interface SalaryAmounts {
  perDay: number;
  allowances: number;
  overtimePay: number;
  gross: number;
  paidDays: number;
  earnedGross: number;
  /** Each fixed component earned for the slip (allowances prorated by paid days; deductions as charged). */
  earnedBase: number;
  earnedComponents: { kind: "ALLOWANCE" | "DEDUCTION"; title: string; rate: number; amount: number }[];
  leavePaymentAmount: number;
  extraDaysAmount: number;
  pf: number;
  pfEmployer: number;
  esic: number;
  esicEmployer: number;
  otherDeductions: number;
  installment: number;
  tds: number;
  surcharge: number;
  educationCess: number;
  lateFeeInterest: number;
  arrears: number;
  totalDeductions: number;
  net: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeSalary(params: {
  setup: SalarySetupSnapshot;
  days: SalaryDays;
  overtimeHours: number;
  arrears: number;
  installment: number;
  hasNoPunches: boolean;
}): SalaryAmounts {
  const { setup, days, overtimeHours, arrears, hasNoPunches } = params;
  const base = setup.baseMonthlySalary;
  const allowances = r2(setup.components.filter((c) => c.kind === "ALLOWANCE").reduce((s, c) => s + c.amount, 0));
  const fixedDeductions = r2(setup.components.filter((c) => c.kind === "DEDUCTION").reduce((s, c) => s + c.amount, 0));
  const dim = Math.max(1, days.calendarDays);

  const perDay = r2((base + allowances) / dim);
  const overtimePay = r2(setup.overtimeRatePerHour * overtimeHours);
  const cap = (wage: number, limit: number | null) => (limit !== null && limit > 0 ? Math.min(wage, limit) : wage);
  const pfWage = setup.pf ? cap(base, setup.pf.maxLimit) : 0;
  const esicWage = setup.esic ? cap(base + allowances, setup.esic.maxLimit) : 0;

  const pf = hasNoPunches || !setup.pf ? 0 : r2((setup.pf.employeeRate / 100) * pfWage);
  const pfEmployer = hasNoPunches || !setup.pf ? 0 : r2((setup.pf.employerRate / 100) * pfWage);
  const esic = hasNoPunches || !setup.esic ? 0 : r2((setup.esic.employeeRate / 100) * esicWage);
  const esicEmployer = hasNoPunches || !setup.esic ? 0 : r2((setup.esic.employerRate / 100) * esicWage);
  const otherDeductions = hasNoPunches ? 0 : fixedDeductions;
  const installment = hasNoPunches ? 0 : r2(params.installment);

  const gross = r2(base + allowances + overtimePay);
  const paidDays = r2(days.presentDays + days.weekendDays + days.holidayDays + days.paidLeaveDays + days.extraDays);
  const earnedGross = Math.round((gross / dim) * paidDays);

  const totalDeductions = r2(otherDeductions + pf + esic);
  const taxes = setup.tdsAmount + setup.surchargeAmount + setup.educationCess + setup.lateFeeInterest;
  const net = Math.max(0, Math.round(earnedGross + arrears - (totalDeductions + installment + taxes)));

  const ratio = paidDays / dim;
  return {
    perDay,
    allowances,
    overtimePay,
    gross,
    paidDays,
    earnedGross,
    earnedBase: r2(base * ratio),
    earnedComponents: setup.components.map((c) => ({
      kind: c.kind,
      title: c.title,
      rate: c.amount,
      amount: c.kind === "ALLOWANCE" ? r2(c.amount * ratio) : hasNoPunches ? 0 : c.amount,
    })),
    leavePaymentAmount: r2(perDay * days.paidLeaveDays),
    extraDaysAmount: r2(perDay * days.extraDays),
    pf,
    pfEmployer,
    esic,
    esicEmployer,
    otherDeductions,
    installment,
    tds: setup.tdsAmount,
    surcharge: setup.surchargeAmount,
    educationCess: setup.educationCess,
    lateFeeInterest: setup.lateFeeInterest,
    arrears: r2(arrears),
    totalDeductions: r2(totalDeductions + installment + taxes),
    net,
  };
}

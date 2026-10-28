import type { Prisma } from "@prisma/client";
import { buildXlsxBuffer, type XlsxColumn } from "@/lib/xlsx";
import type { SalaryAmounts, SalarySetupSnapshot } from "./salary-calculator";

/** Salary report for one finalised month (Salary History → Excel), one row per employee. */
export async function buildSalaryReportXlsx(run: { year: number; month: number; lines: Prisma.SalaryRunLineGetPayload<object>[] }) {
  const n = "number" as const;
  const columns: XlsxColumn[] = [
    { header: "Code", key: "code", width: 12 },
    { header: "Name", key: "name", width: 24 },
    { header: "Days", key: "days", width: 7, type: n },
    { header: "Present", key: "present", width: 9, type: n },
    { header: "Weekly off + Holiday", key: "off", width: 11, type: n },
    { header: "Paid Leave", key: "paidLeave", width: 10, type: n },
    { header: "Extra Days", key: "extra", width: 10, type: n },
    { header: "Paid Days", key: "paidDays", width: 10, type: n },
    { header: "Basic", key: "basic", type: n },
    { header: "Allowances", key: "allowances", type: n },
    { header: "OT Hours", key: "otHours", width: 9, type: n },
    { header: "Gross (full month)", key: "gross", type: n },
    { header: "Earned Gross", key: "earned", type: n },
    { header: "Arrears", key: "arrears", type: n },
    { header: "PF", key: "pf", type: n },
    { header: "ESIC", key: "esic", type: n },
    { header: "Other Deductions", key: "other", type: n },
    { header: "Advance", key: "advance", type: n },
    { header: "TDS", key: "tds", type: n },
    { header: "Surcharge + Cess + Late Fee", key: "taxes", type: n },
    { header: "Total Deductions", key: "deductions", type: n },
    { header: "Net Payable", key: "net", type: n },
    { header: "Bank", key: "bank", width: 18 },
    { header: "Account No.", key: "account", width: 20 },
    { header: "IFSC", key: "ifsc", width: 14 },
  ];
  const num = (v: Prisma.Decimal | number | null) => (v === null ? 0 : Number(v));
  const rows = run.lines.map((l) => {
    const a = l.amountsJson as unknown as SalaryAmounts;
    const setup = l.setupJson as unknown as SalarySetupSnapshot;
    return {
      code: l.employeeCode,
      name: l.employeeName,
      days: l.calendarDays,
      present: l.presentDays === null ? num(l.systemPresentDays) : num(l.presentDays),
      off: num(l.weekendDays) + num(l.holidayDays),
      paidLeave: l.paidLeaveDays === null ? num(l.systemPaidLeaveDays) : num(l.paidLeaveDays),
      extra: l.extraDays === null ? num(l.systemExtraDays) : num(l.extraDays),
      paidDays: a.paidDays,
      basic: setup.baseMonthlySalary,
      allowances: a.allowances,
      otHours: num(l.overtimeHours),
      gross: a.gross,
      earned: a.earnedGross,
      arrears: a.arrears,
      pf: a.pf,
      esic: a.esic,
      other: a.otherDeductions,
      advance: a.installment,
      tds: a.tds,
      taxes: a.surcharge + a.educationCess + a.lateFeeInterest,
      deductions: a.totalDeductions,
      net: a.net,
      bank: setup.bankName ?? "",
      account: setup.bankAccountNumber ?? "",
      ifsc: setup.bankIfsc ?? "",
    };
  });
  return buildXlsxBuffer(`Salary ${run.year}-${String(run.month).padStart(2, "0")}`, columns, rows);
}

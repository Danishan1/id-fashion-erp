import { describe, expect, it } from "vitest";
import { computeSalary, type SalarySetupSnapshot } from "./salary-calculator";

const setup: SalarySetupSnapshot = {
  baseMonthlySalary: 20000,
  components: [
    { kind: "ALLOWANCE", title: "HRA", amount: 8000 },
    { kind: "ALLOWANCE", title: "Conveyance", amount: 2000 },
    { kind: "DEDUCTION", title: "LIC", amount: 500 },
  ],
  pf: { title: "PF", employeeRate: 12, employerRate: 12, maxLimit: 15000 },
  esic: { title: "ESIC", employeeRate: 0.75, employerRate: 3.25, maxLimit: null },
  tdsAmount: 1000,
  surchargeAmount: 0,
  educationCess: 40,
  lateFeeInterest: 0,
  overtimeRatePerHour: 100,
  panNumber: null,
  uanNumber: null,
  esicNumber: null,
  bankName: null,
  bankAccountNumber: null,
  bankIfsc: null,
  bankBranch: null,
};

const fullMonth = { calendarDays: 30, presentDays: 22, weekendDays: 4, holidayDays: 1, paidLeaveDays: 1, extraDays: 0 };

describe("computeSalary (reference formula)", () => {
  it("full month: gross incl. OT, PF capped, ESIC on base + allowances, net after every deduction", () => {
    const a = computeSalary({ setup, days: { ...fullMonth, presentDays: 24 }, overtimeHours: 10, arrears: 0, installment: 0, hasNoPunches: false });
    expect(a.perDay).toBe(1000); // (20000 + 10000) / 30
    expect(a.overtimePay).toBe(1000);
    expect(a.gross).toBe(31000);
    expect(a.paidDays).toBe(30);
    expect(a.earnedGross).toBe(31000);
    expect(a.pf).toBe(1800); // 12% of the 15,000 ceiling
    expect(a.esic).toBe(225); // 0.75% of 30,000
    expect(a.totalDeductions).toBe(500 + 1800 + 225 + 1000 + 40);
    expect(a.net).toBe(31000 - 3565);
  });

  it("prorates earned gross by paid days and adds arrears / extra days; subtracts the installment", () => {
    const a = computeSalary({ setup, days: { ...fullMonth, presentDays: 18, extraDays: 1 }, overtimeHours: 0, arrears: 1500, installment: 2000, hasNoPunches: false });
    // paid days = 18 + 4 + 1 + 1 + 1 = 25 ; earned = round(30000 / 30 * 25)
    expect(a.paidDays).toBe(25);
    expect(a.earnedGross).toBe(25000);
    expect(a.extraDaysAmount).toBe(1000);
    expect(a.leavePaymentAmount).toBe(1000);
    expect(a.net).toBe(25000 + 1500 - (500 + 1800 + 225 + 2000 + 1000 + 40));
    expect(a.earnedComponents.find((c) => c.title === "HRA")?.amount).toBeCloseTo(8000 * (25 / 30), 2);
  });

  it("no punches: PF, ESIC, fixed deductions and installment are 0 (tax still applies); net never negative", () => {
    const a = computeSalary({ setup, days: { ...fullMonth, presentDays: 0, paidLeaveDays: 0 }, overtimeHours: 0, arrears: 0, installment: 5000, hasNoPunches: true });
    expect([a.pf, a.esic, a.otherDeductions, a.installment]).toEqual([0, 0, 0, 0]);
    expect(a.earnedGross).toBe(5000); // weekly offs + holiday still paid
    expect(a.net).toBe(5000 - 1040);
    const z = computeSalary({ setup: { ...setup, tdsAmount: 99999 }, days: fullMonth, overtimeHours: 0, arrears: 0, installment: 0, hasNoPunches: false });
    expect(z.net).toBe(0);
  });

  it("without PF / ESIC settings nothing is charged", () => {
    const a = computeSalary({ setup: { ...setup, pf: null, esic: null }, days: fullMonth, overtimeHours: 0, arrears: 0, installment: 0, hasNoPunches: false });
    expect(a.pf).toBe(0);
    expect(a.esic).toBe(0);
  });
});

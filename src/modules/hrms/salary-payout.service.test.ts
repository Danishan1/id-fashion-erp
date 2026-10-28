import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  salaryRun: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  salaryRunEvent: { create: vi.fn() },
  chartOfAccount: { upsert: vi.fn() },
  journal: { create: vi.fn() },
  journalLine: { findMany: vi.fn() },
  paymentRequest: { findMany: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const pr = vi.hoisted(() => ({ createPaymentRequest: vi.fn() }));
const journal = vi.hoisted(() => ({ postJournalCore: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn().mockResolvedValue("JRN-1") }));
vi.mock("@/modules/accounts/journal.service", () => journal);
vi.mock("@/modules/accounts/payment-requests/payment-request.service", () => pr);

const { buildSalaryAccrualLines, sendSalaryRunToAccounts, undoSendToAccountsInTx } = await import("./salary-payout.service");
const actor = { companyId: "c1", userId: "u1" };

const amounts = (p: Record<string, number> = {}) =>
  ({ net: 25000, pf: 1800, pfEmployer: 1800, esic: 0, esicEmployer: 0, tds: 1000, surcharge: 0, educationCess: 40, lateFeeInterest: 0, installment: 3000, otherDeductions: 500, ...p }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.chartOfAccount.upsert.mockImplementation(async ({ create }: { create: { code: string } }) => ({ id: create.code }));
  db.journal.create.mockResolvedValue({ id: "j1" });
  db.salaryRun.updateMany.mockResolvedValue({ count: 1 });
  pr.createPaymentRequest.mockResolvedValue({ id: "pr" });
  db.paymentRequest.findMany.mockResolvedValue([]);
  db.salaryRun.findUniqueOrThrow.mockResolvedValue({ sentToAccountsAt: new Date(1000) });
});

describe("buildSalaryAccrualLines", () => {
  it("credits each payable, debits expense as the balancing figure, and always balances", () => {
    const lines = buildSalaryAccrualLines([amounts(), amounts({ net: 10000.5, pf: 0, pfEmployer: 0, installment: 0, otherDeductions: 0, tds: 0, educationCess: 0 })]);
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.SALARY_PAY.credit).toBe(35000.5);
    expect(by.PF_PAY.credit).toBe(3600);
    expect(by.TDS_PAY.credit).toBe(1040);
    expect(by.SAL_ADV.credit).toBe(3000);
    expect(by.DED_PAY.credit).toBe(500);
    expect(by.EMPLOYER_EXPENSE.debit).toBe(1800);
    expect(by.EXPENSE.debit).toBe(35000.5 + 3600 + 1040 + 3000 + 500 - 1800);
    expect(by.ESIC_PAY).toBeUndefined(); // zero lines are left out
    const dr = lines.reduce((s, l) => s + l.debit, 0);
    const cr = lines.reduce((s, l) => s + l.credit, 0);
    expect(dr).toBeCloseTo(cr, 6);
  });
});

describe("sendSalaryRunToAccounts", () => {
  const run = (p: Record<string, unknown> = {}) => ({
    id: "r1",
    year: 2026,
    month: 9,
    status: "FINALISED",
    sentToAccountsAt: null,
    lines: [
      { id: "l1", employeeId: "e1", employeeName: "Ravi", netAmount: 25000, amountsJson: amounts() },
      { id: "l2", employeeId: "e2", employeeName: "Zero", netAmount: 0, amountsJson: amounts({ net: 0, pf: 0, pfEmployer: 0, installment: 0, otherDeductions: 0, tds: 0, educationCess: 0 }) },
    ],
    ...p,
  });

  it("posts the accrual once and raises one SALARY request per employee with pay, due the 7th of next month", async () => {
    db.salaryRun.findFirst.mockResolvedValue(run());
    const r = await sendSalaryRunToAccounts(actor, "r1");
    expect(db.journal.create.mock.calls[0][0].data).toMatchObject({ sourceModule: "SALARY_RUN", sourceRecordId: "r1", journalNumber: "JRN-1" });
    expect(journal.postJournalCore).toHaveBeenCalledWith(db, "j1", "DRAFT", "u1");
    expect(pr.createPaymentRequest).toHaveBeenCalledTimes(1);
    expect(pr.createPaymentRequest.mock.calls[0][1]).toMatchObject({ requestType: "SALARY", amount: 25000, employeeId: "e1", paymentDueDate: "2026-10-07", idempotencyKey: "salary:r1:e1:1000" });
    expect(pr.createPaymentRequest.mock.calls[0][2]).toEqual({ fromSource: true, source: { module: "SALARY_RUN_LINE", recordId: "l1" } });
    expect(r).toEqual({ requests: 1, failed: [] });
  });

  it("sending again skips the journal and employees who already have a request", async () => {
    db.salaryRun.findFirst.mockResolvedValue(run({ sentToAccountsAt: new Date() }));
    await sendSalaryRunToAccounts(actor, "r1");
    expect(db.journal.create).not.toHaveBeenCalled();
    expect(pr.createPaymentRequest).toHaveBeenCalledTimes(1);

    db.paymentRequest.findMany.mockResolvedValue([{ id: "p1", status: "APPROVED", sourceRecordId: "l1" }]);
    const r = await sendSalaryRunToAccounts(actor, "r1");
    expect(pr.createPaymentRequest).toHaveBeenCalledTimes(1);
    expect(r.requests).toBe(0);
  });

  it("only a finalised run can be sent; a failed request is reported, not fatal", async () => {
    db.salaryRun.findFirst.mockResolvedValueOnce(run({ status: "APPROVED" }));
    await expect(sendSalaryRunToAccounts(actor, "r1")).rejects.toThrow(/Only a finalised/);
    db.salaryRun.findFirst.mockResolvedValueOnce(run());
    pr.createPaymentRequest.mockRejectedValueOnce(new Error("Employee not found or inactive."));
    const r = await sendSalaryRunToAccounts(actor, "r1");
    expect(r.failed).toEqual([{ employeeName: "Ravi", error: "Employee not found or inactive." }]);
  });
});

describe("undoSendToAccountsInTx (reopen)", () => {
  const runRow = { id: "r1", year: 2026, month: 9, accrualJournalId: "j1" };

  it("refuses once any salary was paid", async () => {
    db.paymentRequest.findMany.mockResolvedValue([{ id: "p1", requestNumber: "PRQ-1", status: "PAID", paidAmount: 25000 }]);
    await expect(undoSendToAccountsInTx(db as never, actor, runRow, ["l1"], "JRN-2")).rejects.toThrow(/already been paid/);
    expect(db.paymentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("cancels open requests and posts the reversed accrual", async () => {
    db.paymentRequest.findMany.mockResolvedValue([{ id: "p1", requestNumber: "PRQ-1", status: "APPROVED", paidAmount: 0 }]);
    db.journalLine.findMany.mockResolvedValue([
      { accountId: "EXP-SALARY", debitAmount: 100, creditAmount: 0, description: "x" },
      { accountId: "SALARY-PAY", debitAmount: 0, creditAmount: 100, description: "y" },
    ]);
    await undoSendToAccountsInTx(db as never, actor, runRow, ["l1"], "JRN-2");
    expect(db.paymentRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED", cancelledByUserId: "u1" });
    const lines = db.journal.create.mock.calls[0][0].data.lines.create;
    expect(lines.map((l: { accountId: string; debitAmount: number; creditAmount: number }) => [l.accountId, l.debitAmount, l.creditAmount])).toEqual([
      ["EXP-SALARY", 0, 100],
      ["SALARY-PAY", 100, 0],
    ]);
    expect(db.salaryRun.update.mock.calls[0][0].data).toEqual({ sentToAccountsAt: null, sentToAccountsByUserId: null, accrualJournalId: null });
  });
});

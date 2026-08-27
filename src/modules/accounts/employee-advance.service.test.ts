import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/employees/employee.repository", () => ({
  EmployeeRepository: { findById: vi.fn() },
}));
vi.mock("@/modules/finance-config/finance-config.repository", () => ({
  FinanceConfigRepository: { paymentType: { findFirst: vi.fn() }, bankAccount: { findFirst: vi.fn() } },
}));
vi.mock("./employee-advance.repository", () => ({
  EmployeeAdvanceRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    create: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
  EmployeeAdvanceSettlementRepository: {
    findAnyById: vi.fn(),
    create: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findByCode: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("./tax-config.repository", () => ({
  TaxRateRepository: { findAnyById: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: { $transaction: vi.fn(), employeeAdvanceSettlement: { findFirst: vi.fn() } },
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { EmployeeRepository } = await import("@/modules/employees/employee.repository");
const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { EmployeeAdvanceRepository, EmployeeAdvanceSettlementRepository } = await import("./employee-advance.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { TaxRateRepository } = await import("./tax-config.repository");
const { postJournalCore } = await import("./journal.service");
const {
  createEmployeeAdvance,
  issueEmployeeAdvance,
  cancelEmployeeAdvance,
  createEmployeeAdvanceSettlement,
  postEmployeeAdvanceSettlement,
  cancelEmployeeAdvanceSettlement,
} = await import("./employee-advance.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(EmployeeRepository.findById).mockReset();
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset();
  vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockReset();
  vi.mocked(EmployeeAdvanceRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(EmployeeAdvanceRepository.create).mockReset();
  vi.mocked(EmployeeAdvanceRepository.findAnyById).mockReset();
  vi.mocked(EmployeeAdvanceRepository.findByIdWithDetails).mockReset();
  vi.mocked(EmployeeAdvanceRepository.updateStatusConditional).mockReset();
  vi.mocked(EmployeeAdvanceSettlementRepository.findAnyById).mockReset();
  vi.mocked(EmployeeAdvanceSettlementRepository.create).mockReset();
  vi.mocked(EmployeeAdvanceSettlementRepository.updateStatusConditional).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(ChartOfAccountRepository.findAnyById).mockReset();
  vi.mocked(TaxRateRepository.findAnyById).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(prisma.employeeAdvanceSettlement.findFirst).mockReset();
});

describe("createEmployeeAdvance", () => {
  it("creates a DRAFT advance", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1" } as never);
    vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockResolvedValue({ id: "pt-cash", type: "CASH" } as never);
    vi.mocked(EmployeeAdvanceRepository.create).mockResolvedValue({ id: "adv-1", status: "DRAFT" } as never);

    const result = await createEmployeeAdvance(actor, {
      advanceDate: "2026-08-27",
      employeeId: "emp-1",
      amount: 5000,
      paymentTypeId: "pt-cash",
    } as never);

    expect(result).toMatchObject({ id: "adv-1" });
  });

  it("rejects an unknown employee", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue(null);

    await expect(
      createEmployeeAdvance(actor, {
        advanceDate: "2026-08-27",
        employeeId: "emp-x",
        amount: 5000,
        paymentTypeId: "pt-cash",
      } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(EmployeeAdvanceRepository.create).not.toHaveBeenCalled();
  });
});

describe("issueEmployeeAdvance", () => {
  it("rejects issuing a non-DRAFT advance", async () => {
    vi.mocked(EmployeeAdvanceRepository.findByIdWithDetails).mockResolvedValue({
      id: "adv-1",
      status: "ISSUED",
      createdByUserId: "user-1",
    } as never);

    await expect(issueEmployeeAdvance(actor, "adv-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("posts Dr Employee Advances / Cr Cash-or-Bank for the advance amount", async () => {
    vi.mocked(EmployeeAdvanceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "adv-1",
        status: "DRAFT",
        createdByUserId: "user-1",
        amount: "5000",
        advanceDate: new Date("2026-08-27"),
        advanceNumber: "ADV-2026-00001",
        employee: { fullName: "Jane Doe" },
        paymentType: { type: "CASH" },
      } as never)
      .mockResolvedValueOnce({ id: "adv-1", status: "ISSUED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(((_c: string, code: string) => Promise.resolve({ id: `acct-${code}` })) as never);

    let capturedLines: unknown;
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        journal: {
          create: vi.fn().mockImplementation((args) => {
            capturedLines = args.data.lines.create;
            return { id: "jrn-1" };
          }),
        },
        employeeAdvance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })
    );

    await issueEmployeeAdvance(actor, "adv-1");

    expect(capturedLines).toEqual([
      { accountId: "acct-EMP-ADV", lineNumber: 1, debitAmount: 5000, creditAmount: 0, description: "Advance ADV-2026-00001" },
      { accountId: "acct-CASH", lineNumber: 2, debitAmount: 0, creditAmount: 5000, description: "Advance ADV-2026-00001" },
    ]);
  });
});

describe("cancelEmployeeAdvance", () => {
  it("cancels a DRAFT advance", async () => {
    vi.mocked(EmployeeAdvanceRepository.findAnyById)
      .mockResolvedValueOnce({ id: "adv-1", status: "DRAFT" } as never)
      .mockResolvedValueOnce({ id: "adv-1", status: "CANCELLED" } as never);
    vi.mocked(EmployeeAdvanceRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    const result = await cancelEmployeeAdvance(actor, "adv-1");
    expect(result.status).toBe("CANCELLED");
  });

  it("blocks cancelling a non-DRAFT advance", async () => {
    vi.mocked(EmployeeAdvanceRepository.findAnyById).mockResolvedValue({ id: "adv-1", status: "ISSUED" } as never);
    vi.mocked(EmployeeAdvanceRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelEmployeeAdvance(actor, "adv-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("createEmployeeAdvanceSettlement", () => {
  it("rejects settling an advance that isn't ISSUED/PARTIALLY_SETTLED", async () => {
    vi.mocked(EmployeeAdvanceRepository.findAnyById).mockResolvedValue({ id: "adv-1", status: "DRAFT" } as never);

    await expect(
      createEmployeeAdvanceSettlement(actor, "adv-1", {
        settlementDate: "2026-08-27",
        expenseAccountId: "acct-1",
        description: "Travel",
        amount: 1000,
      } as never)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a settlement whose amount exceeds what's remaining unsettled", async () => {
    vi.mocked(EmployeeAdvanceRepository.findAnyById).mockResolvedValue({
      id: "adv-1",
      status: "PARTIALLY_SETTLED",
      amount: "5000",
      settledAmount: "4500",
    } as never);
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({
      id: "acct-1",
      accountType: "EXPENSE",
      code: "EXP-TRAVEL",
      name: "Travel Expense",
      isActive: true,
    } as never);

    await expect(
      createEmployeeAdvanceSettlement(actor, "adv-1", {
        settlementDate: "2026-08-27",
        expenseAccountId: "acct-1",
        description: "Travel",
        amount: 1000,
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(EmployeeAdvanceSettlementRepository.create).not.toHaveBeenCalled();
  });

  it("rejects posting against the COGS control account", async () => {
    vi.mocked(EmployeeAdvanceRepository.findAnyById).mockResolvedValue({
      id: "adv-1",
      status: "ISSUED",
      amount: "5000",
      settledAmount: "0",
    } as never);
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({
      id: "acct-cogs",
      accountType: "EXPENSE",
      code: "COGS",
      name: "Cost of Goods Sold",
      isActive: true,
    } as never);

    await expect(
      createEmployeeAdvanceSettlement(actor, "adv-1", {
        settlementDate: "2026-08-27",
        expenseAccountId: "acct-cogs",
        description: "x",
        amount: 100,
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates a DRAFT settlement within the remaining balance, computing tax", async () => {
    vi.mocked(EmployeeAdvanceRepository.findAnyById).mockResolvedValue({
      id: "adv-1",
      status: "ISSUED",
      amount: "5000",
      settledAmount: "0",
    } as never);
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({
      id: "acct-1",
      accountType: "EXPENSE",
      code: "EXP-TRAVEL",
      name: "Travel Expense",
      isActive: true,
    } as never);
    vi.mocked(TaxRateRepository.findAnyById).mockResolvedValue({ id: "tax-1", ratePercentage: "18" } as never);
    vi.mocked(EmployeeAdvanceSettlementRepository.create).mockResolvedValue({ id: "settle-1" } as never);

    const result = await createEmployeeAdvanceSettlement(actor, "adv-1", {
      settlementDate: "2026-08-27",
      expenseAccountId: "acct-1",
      description: "Travel",
      amount: 1000,
      taxRateId: "tax-1",
    } as never);

    expect(result).toMatchObject({ id: "settle-1" });
    expect(EmployeeAdvanceSettlementRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000, taxAmount: 180, totalAmount: 1180 })
    );
  });
});

describe("postEmployeeAdvanceSettlement", () => {
  it("rejects posting a non-DRAFT settlement", async () => {
    vi.mocked(prisma.employeeAdvanceSettlement.findFirst).mockResolvedValue({
      id: "settle-1",
      status: "POSTED",
      createdByUserId: "user-1",
      expenseAccount: { isActive: true },
      employeeAdvance: { status: "ISSUED" },
    } as never);

    await expect(postEmployeeAdvanceSettlement(actor, "settle-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("posts Dr expenseAccount [+GST-ITC] / Cr Employee Advances, and recomputes the advance to PARTIALLY_SETTLED", async () => {
    vi.mocked(prisma.employeeAdvanceSettlement.findFirst).mockResolvedValue({
      id: "settle-1",
      status: "DRAFT",
      createdByUserId: "user-1",
      settlementNumber: "ADVS-2026-00001",
      settlementDate: new Date("2026-08-27"),
      amount: "1000",
      taxAmount: "180",
      totalAmount: "1180",
      expenseAccountId: "acct-travel",
      expenseAccount: { isActive: true },
      employeeAdvanceId: "adv-1",
      employeeAdvance: { id: "adv-1", status: "ISSUED", amount: "5000", settledAmount: "0" },
    } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(((_c: string, code: string) => Promise.resolve({ id: `acct-${code}` })) as never);
    vi.mocked(EmployeeAdvanceSettlementRepository.findAnyById).mockResolvedValue({ id: "settle-1", status: "POSTED" } as never);

    let capturedLines: unknown;
    let newAdvanceStatus: string | undefined;
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        journal: {
          create: vi.fn().mockImplementation((args) => {
            capturedLines = args.data.lines.create;
            return { id: "jrn-1" };
          }),
        },
        employeeAdvanceSettlement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        employeeAdvance: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "adv-1", amount: "5000", settledAmount: "1180" }),
          update: vi.fn().mockImplementation((args) => {
            newAdvanceStatus = args.data.status;
            return {};
          }),
        },
      })
    );

    await postEmployeeAdvanceSettlement(actor, "settle-1");

    expect(capturedLines).toEqual([
      { accountId: "acct-travel", lineNumber: 1, debitAmount: 1000, creditAmount: 0, description: "Settlement ADVS-2026-00001" },
      { accountId: "acct-GST-ITC", lineNumber: 2, debitAmount: 180, creditAmount: 0, description: "Settlement ADVS-2026-00001 — GST Input" },
      { accountId: "acct-EMP-ADV", lineNumber: 3, debitAmount: 0, creditAmount: 1180, description: "Settlement ADVS-2026-00001" },
    ]);
    expect(newAdvanceStatus).toBe("PARTIALLY_SETTLED");
  });

  it("recomputes the advance to SETTLED once settledAmount reaches the full advance amount", async () => {
    vi.mocked(prisma.employeeAdvanceSettlement.findFirst).mockResolvedValue({
      id: "settle-2",
      status: "DRAFT",
      createdByUserId: "user-1",
      settlementNumber: "ADVS-2026-00002",
      settlementDate: new Date("2026-08-27"),
      amount: "3820",
      taxAmount: "0",
      totalAmount: "3820",
      expenseAccountId: "acct-travel",
      expenseAccount: { isActive: true },
      employeeAdvanceId: "adv-1",
      employeeAdvance: { id: "adv-1", status: "PARTIALLY_SETTLED", amount: "5000", settledAmount: "1180" },
    } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(((_c: string, code: string) => Promise.resolve({ id: `acct-${code}` })) as never);
    vi.mocked(EmployeeAdvanceSettlementRepository.findAnyById).mockResolvedValue({ id: "settle-2", status: "POSTED" } as never);

    let newAdvanceStatus: string | undefined;
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        journal: { create: vi.fn().mockResolvedValue({ id: "jrn-2" }) },
        employeeAdvanceSettlement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        employeeAdvance: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "adv-1", amount: "5000", settledAmount: "5000" }),
          update: vi.fn().mockImplementation((args) => {
            newAdvanceStatus = args.data.status;
            return {};
          }),
        },
      })
    );

    await postEmployeeAdvanceSettlement(actor, "settle-2");
    expect(newAdvanceStatus).toBe("SETTLED");
  });
});

describe("cancelEmployeeAdvanceSettlement", () => {
  it("cancels a DRAFT settlement", async () => {
    vi.mocked(EmployeeAdvanceSettlementRepository.findAnyById)
      .mockResolvedValueOnce({ id: "settle-1", status: "DRAFT" } as never)
      .mockResolvedValueOnce({ id: "settle-1", status: "CANCELLED" } as never);
    vi.mocked(EmployeeAdvanceSettlementRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    const result = await cancelEmployeeAdvanceSettlement(actor, "settle-1");
    expect(result?.status).toBe("CANCELLED");
  });

  it("blocks cancelling a non-DRAFT settlement", async () => {
    vi.mocked(EmployeeAdvanceSettlementRepository.findAnyById).mockResolvedValue({ id: "settle-1", status: "POSTED" } as never);
    vi.mocked(EmployeeAdvanceSettlementRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelEmployeeAdvanceSettlement(actor, "settle-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

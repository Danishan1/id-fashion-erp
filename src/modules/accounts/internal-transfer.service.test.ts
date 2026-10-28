import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/finance-config/finance-config.repository", () => ({
  FinanceConfigRepository: { paymentType: { findFirst: vi.fn() }, bankAccount: { findFirst: vi.fn() } },
}));
vi.mock("./internal-transfer.repository", () => ({
  InternalTransferRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    create: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findByCode: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { InternalTransferRepository } = await import("./internal-transfer.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { postJournalCore } = await import("./journal.service");
const { createInternalTransfer, postInternalTransfer, cancelInternalTransfer } = await import("./internal-transfer.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset();
  vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockReset();
  vi.mocked(InternalTransferRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(InternalTransferRepository.create).mockReset();
  vi.mocked(InternalTransferRepository.findAnyById).mockReset();
  vi.mocked(InternalTransferRepository.findByIdWithDetails).mockReset();
  vi.mocked(InternalTransferRepository.updateStatusConditional).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
});

describe("createInternalTransfer", () => {
  beforeEach(() => {
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never);
  });

  it("rejects a transfer whose two sides land on the same ledger account (no bank chosen on either side)", async () => {
    vi.mocked(FinanceConfigRepository.paymentType.findFirst)
      .mockResolvedValueOnce({ id: "pt-bank1", type: "BANK" } as never)
      .mockResolvedValueOnce({ id: "pt-bank2", type: "BANK" } as never);

    await expect(
      createInternalTransfer(actor, {
        transferDate: "2026-08-27",
        fromPaymentTypeId: "pt-bank1",
        toPaymentTypeId: "pt-bank2",
        amount: 100,
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(InternalTransferRepository.create).not.toHaveBeenCalled();
  });

  it("creates a DRAFT transfer between a CASH-typed and a BANK-typed account", async () => {
    vi.mocked(FinanceConfigRepository.paymentType.findFirst)
      .mockResolvedValueOnce({ id: "pt-cash", type: "CASH" } as never)
      .mockResolvedValueOnce({ id: "pt-bank", type: "BANK" } as never);
    vi.mocked(InternalTransferRepository.create).mockResolvedValue({ id: "trf-1", status: "DRAFT" } as never);

    const result = await createInternalTransfer(actor, {
      transferDate: "2026-08-27",
      fromPaymentTypeId: "pt-cash",
      toPaymentTypeId: "pt-bank",
      amount: 5000,
    } as never);

    expect(result).toMatchObject({ id: "trf-1" });
  });

  it("allows bank -> bank when each bank has its own ledger account (financial accounts, 2026-10-28)", async () => {
    vi.mocked(FinanceConfigRepository.paymentType.findFirst)
      .mockResolvedValueOnce({ id: "pt-bank", type: "BANK" } as never)
      .mockResolvedValueOnce({ id: "pt-bank", type: "BANK" } as never);
    vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockImplementation((async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      ledgerAccount: { id: `led-${where.id}`, code: `BANK-${where.id}`, isActive: true },
    })) as never);
    vi.mocked(InternalTransferRepository.create).mockResolvedValue({ id: "trf-2", status: "DRAFT" } as never);

    const result = await createInternalTransfer(actor, {
      transferDate: "2026-10-28",
      fromPaymentTypeId: "pt-bank",
      fromBankAccountId: "sbi",
      toPaymentTypeId: "pt-bank",
      toBankAccountId: "icici",
      amount: 1000,
    } as never);
    expect(result).toMatchObject({ id: "trf-2" });

    // Same bank on both sides is still a no-op and refused.
    vi.mocked(FinanceConfigRepository.paymentType.findFirst)
      .mockResolvedValueOnce({ id: "pt-bank", type: "BANK" } as never)
      .mockResolvedValueOnce({ id: "pt-bank", type: "BANK" } as never);
    await expect(
      createInternalTransfer(actor, {
        transferDate: "2026-10-28",
        fromPaymentTypeId: "pt-bank",
        fromBankAccountId: "sbi",
        toPaymentTypeId: "pt-bank",
        toBankAccountId: "sbi",
        amount: 1000,
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("postInternalTransfer", () => {
  it("rejects posting a non-DRAFT transfer", async () => {
    vi.mocked(InternalTransferRepository.findByIdWithDetails).mockResolvedValue({
      id: "trf-1",
      status: "POSTED",
      createdByUserId: "user-1",
    } as never);

    await expect(postInternalTransfer(actor, "trf-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("posts Dr toAccount / Cr fromAccount for the transfer amount", async () => {
    vi.mocked(InternalTransferRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "trf-1",
        status: "DRAFT",
        createdByUserId: "user-1",
        amount: "5000",
        transferDate: new Date("2026-08-27"),
        transferNumber: "TRF-2026-00001",
        fromPaymentType: { type: "CASH" },
        toPaymentType: { type: "BANK" },
      } as never)
      .mockResolvedValueOnce({ id: "trf-1", status: "POSTED" } as never);
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
        internalTransfer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })
    );

    await postInternalTransfer(actor, "trf-1");

    expect(capturedLines).toEqual([
      { accountId: "acct-BANK", lineNumber: 1, debitAmount: 5000, creditAmount: 0, description: "Transfer TRF-2026-00001" },
      { accountId: "acct-CASH", lineNumber: 2, debitAmount: 0, creditAmount: 5000, description: "Transfer TRF-2026-00001" },
    ]);
  });
});

describe("cancelInternalTransfer", () => {
  it("cancels a DRAFT transfer", async () => {
    vi.mocked(InternalTransferRepository.findAnyById)
      .mockResolvedValueOnce({ id: "trf-1", status: "DRAFT" } as never)
      .mockResolvedValueOnce({ id: "trf-1", status: "CANCELLED" } as never);
    vi.mocked(InternalTransferRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    const result = await cancelInternalTransfer(actor, "trf-1");
    expect(result.status).toBe("CANCELLED");
  });

  it("blocks cancelling a non-DRAFT transfer", async () => {
    vi.mocked(InternalTransferRepository.findAnyById).mockResolvedValue({ id: "trf-1", status: "POSTED" } as never);
    vi.mocked(InternalTransferRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelInternalTransfer(actor, "trf-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

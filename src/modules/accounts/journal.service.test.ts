import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findAnyById: vi.fn(), findMany: vi.fn(), sumPostedLinesByAccount: vi.fn() },
}));
vi.mock("./journal.repository", () => ({
  JournalRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    createWithLines: vi.fn(),
    replaceLines: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));

function makeFakeTx(overrides: { debitSum?: number; creditSum?: number; updateManyCount?: number } = {}) {
  const { debitSum = 0, creditSum = 0, updateManyCount = 1 } = overrides;
  return {
    journalLine: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { debitAmount: debitSum, creditAmount: creditSum } }),
    },
    journal: {
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
      create: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
  };
}

vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { JournalRepository } = await import("./journal.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { postJournal, reverseJournal, getTrialBalance } = await import("./journal.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(JournalRepository.findAnyById).mockReset();
  vi.mocked(JournalRepository.findByIdWithDetails).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
});

describe("postJournal — balance check + self-approval guard", () => {
  it("throws UNBALANCED_JOURNAL when a fresh DB read shows debit != credit, never trusting a cached total", async () => {
    vi.mocked(JournalRepository.findAnyById).mockResolvedValue({
      id: "j-1",
      status: "DRAFT",
      createdByUserId: "user-1",
    } as never);

    const fakeTx = makeFakeTx({ debitSum: 100, creditSum: 90 });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await expect(postJournal(actor, "j-1")).rejects.toMatchObject({ code: "UNBALANCED_JOURNAL" });
  });

  it("posts successfully and asserts the self-approval-guarded 'post' action with resourceContext.createdBy", async () => {
    vi.mocked(JournalRepository.findAnyById).mockResolvedValue({
      id: "j-1",
      status: "DRAFT",
      createdByUserId: "user-1",
    } as never);
    vi.mocked(JournalRepository.findByIdWithDetails).mockResolvedValue({ id: "j-1", status: "POSTED" } as never);

    const fakeTx = makeFakeTx({ debitSum: 100, creditSum: 100 });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postJournal(actor, "j-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "accounts", "post", { createdBy: "user-1" });
    expect(fakeTx.journal.updateMany).toHaveBeenCalledWith({
      where: { id: "j-1", status: "DRAFT" },
      data: expect.objectContaining({ status: "POSTED", totalDebit: 100, totalCredit: 100 }),
    });
  });

  it("throws INVALID_STATE_TRANSITION when the guarded status flip loses the double-click race (count 0)", async () => {
    vi.mocked(JournalRepository.findAnyById).mockResolvedValue({
      id: "j-1",
      status: "DRAFT",
      createdByUserId: "user-1",
    } as never);

    const fakeTx = makeFakeTx({ debitSum: 100, creditSum: 100, updateManyCount: 0 });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await expect(postJournal(actor, "j-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects posting a journal that is not DRAFT before ever touching the transaction", async () => {
    vi.mocked(JournalRepository.findAnyById).mockResolvedValue({
      id: "j-1",
      status: "POSTED",
      createdByUserId: "user-1",
    } as never);

    await expect(postJournal(actor, "j-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("reverseJournal — internal auto-post bypasses the self-approval guard", () => {
  it("asserts 'cancel' exactly once and never calls PermissionService.assert for 'post' on its own auto-posted reversal", async () => {
    vi.mocked(JournalRepository.findByIdWithDetails).mockResolvedValue({
      id: "j-1",
      journalNumber: "JRN-2026-00001",
      status: "POSTED",
      sourceModule: null,
      sourceRecordId: null,
      lines: [
        { accountId: "acc-cash", debitAmount: 100, creditAmount: 0, description: null },
        { accountId: "acc-rev", debitAmount: 0, creditAmount: 100, description: null },
      ],
    } as never);

    const fakeTx = {
      ...makeFakeTx({ debitSum: 100, creditSum: 100 }),
      journal: {
        ...makeFakeTx({ debitSum: 100, creditSum: 100 }).journal,
        create: vi.fn().mockResolvedValue({ id: "j-2" }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "j-2", journalNumber: "JRN-2026-00002", status: "POSTED" }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await reverseJournal(actor, "j-1", { narration: "" });

    // Exactly one assert call for the whole operation — the outer "cancel" gate.
    // A second call with action "post" would mean the internal auto-post
    // incorrectly re-ran the public, self-approval-guarded path, which would
    // make reversal unusable for anyone but SUPER_ADMIN (their own reversal's
    // createdByUserId is always themselves).
    expect(PermissionService.assert).toHaveBeenCalledTimes(1);
    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "accounts", "cancel");
  });

  it("flips every line's debit/credit when building the reversal", async () => {
    vi.mocked(JournalRepository.findByIdWithDetails).mockResolvedValue({
      id: "j-1",
      journalNumber: "JRN-2026-00001",
      status: "POSTED",
      sourceModule: null,
      sourceRecordId: null,
      lines: [
        { accountId: "acc-cash", debitAmount: 100, creditAmount: 0, description: "orig" },
        { accountId: "acc-rev", debitAmount: 0, creditAmount: 100, description: "orig" },
      ],
    } as never);

    const created = vi.fn().mockResolvedValue({ id: "j-2" });
    const fakeTx = {
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debitAmount: 100, creditAmount: 100 } }) },
      journal: {
        create: created,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "j-2" }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await reverseJournal(actor, "j-1", { narration: "" });

    const createArgs = created.mock.calls[0][0];
    expect(createArgs.data.lines.create).toEqual([
      { accountId: "acc-cash", debitAmount: 0, creditAmount: 100, description: "orig", lineNumber: 1 },
      { accountId: "acc-rev", debitAmount: 100, creditAmount: 0, description: "orig", lineNumber: 2 },
    ]);
    expect(createArgs.data.reversalOfJournalId).toBe("j-1");
  });

  it("rejects reversing a journal that isn't POSTED", async () => {
    vi.mocked(JournalRepository.findByIdWithDetails).mockResolvedValue({ id: "j-1", status: "DRAFT" } as never);

    await expect(reverseJournal(actor, "j-1", { narration: "" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  // Regression test for the P2 fix: this previously relied solely on the DB's
  // `@unique` constraint on reversalOfJournalId, so a second reversal attempt
  // propagated a raw Prisma P2002 as an unhandled 500 instead of a clean
  // business error.
  it("rejects reversing a journal that's already been reversed, with a clean error naming the existing reversal", async () => {
    vi.mocked(JournalRepository.findByIdWithDetails).mockResolvedValue({
      id: "j-1",
      status: "POSTED",
      sourceModule: null,
      reversedByJournal: { id: "j-2", journalNumber: "JRN-2026-00002" },
    } as never);

    await expect(reverseJournal(actor, "j-1", { narration: "" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("getTrialBalance", () => {
  it("nets a reversed journal's lines to zero automatically (no special-casing needed)", async () => {
    vi.mocked(ChartOfAccountRepository.sumPostedLinesByAccount).mockResolvedValue([
      { accountId: "acc-cash", _sum: { debitAmount: 100, creditAmount: 100 } },
    ] as never);
    vi.mocked(ChartOfAccountRepository.findMany).mockResolvedValue([
      { id: "acc-cash", code: "CASH", name: "Cash", accountType: "ASSET" },
    ] as never);

    const { rows, grandTotalDebit, grandTotalCredit } = await getTrialBalance("co-1");

    expect(rows[0]).toMatchObject({ totalDebit: 100, totalCredit: 100, netBalance: 0 });
    expect(grandTotalDebit).toBe(100);
    expect(grandTotalCredit).toBe(100);
  });

  it("reports an account with no activity as all zeros, not missing", async () => {
    vi.mocked(ChartOfAccountRepository.sumPostedLinesByAccount).mockResolvedValue([] as never);
    vi.mocked(ChartOfAccountRepository.findMany).mockResolvedValue([
      { id: "acc-cash", code: "CASH", name: "Cash", accountType: "ASSET" },
    ] as never);

    const { rows } = await getTrialBalance("co-1");
    expect(rows[0]).toMatchObject({ totalDebit: 0, totalCredit: 0, netBalance: 0 });
  });
});

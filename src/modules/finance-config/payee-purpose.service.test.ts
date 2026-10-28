import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/accounts/chart-of-account.service", () => ({ assertValidExpenseAccount: vi.fn() }));
vi.mock("./finance-config.repository", () => ({
  FinanceConfigRepository: {
    payee: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    expensePurpose: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    chartOfAccount: { findMany: vi.fn() },
  },
}));

const { FinanceConfigRepository } = await import("./finance-config.repository");
const { assertValidExpenseAccount } = await import("@/modules/accounts/chart-of-account.service");
const { createPayee, updatePayee, createExpensePurpose, updateExpensePurpose, listExpenseAccountOptions } = await import(
  "./payee-purpose.service"
);
const { payeeSchema } = await import("./finance-config.schema");

const actor = { companyId: "co-1", userId: "user-1" };
const base = { code: "SHARMA", name: "Sharma Electricals", payeeType: "BUSINESS" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(FinanceConfigRepository.payee.findFirst).mockResolvedValue(null);
  vi.mocked(FinanceConfigRepository.payee.create).mockImplementation((async ({ data }: { data: object }) => ({ id: "py-1", ...data })) as never);
  vi.mocked(FinanceConfigRepository.expensePurpose.findFirst).mockResolvedValue(null);
  vi.mocked(FinanceConfigRepository.expensePurpose.create).mockImplementation((async ({ data }: { data: object }) => ({ id: "pp-1", ...data })) as never);
});

describe("payees", () => {
  it("takes the GST state from the GSTIN (and upper-cases it)", async () => {
    const payee = await createPayee(actor, { ...base, gstin: "07abcde1234f1z5", stateCode: "27" });
    expect(payee).toMatchObject({ gstin: "07ABCDE1234F1Z5", stateCode: "07", isActive: true });
  });

  it("refuses a malformed GSTIN and an unknown state code", async () => {
    await expect(createPayee(actor, { ...base, gstin: "07ABC" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createPayee(actor, { ...base, stateCode: "99" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a duplicate code or the same name (any case)", async () => {
    vi.mocked(FinanceConfigRepository.payee.findFirst).mockResolvedValueOnce({ id: "old" } as never);
    await expect(createPayee(actor, base)).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });

    vi.mocked(FinanceConfigRepository.payee.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "old", name: "SHARMA ELECTRICALS" } as never);
    await expect(createPayee(actor, base)).rejects.toThrow(/already exists/);
  });

  it("a plain edit keeps isActive; NOT_FOUND for another company's payee", async () => {
    vi.mocked(FinanceConfigRepository.payee.findFirst).mockResolvedValueOnce({ id: "py-1", isActive: false } as never);
    vi.mocked(FinanceConfigRepository.payee.update).mockResolvedValue({ id: "py-1" } as never);
    await updatePayee(actor, "py-1", base);
    expect(vi.mocked(FinanceConfigRepository.payee.update).mock.calls[0][0].data).not.toHaveProperty("isActive");

    vi.mocked(FinanceConfigRepository.payee.findFirst).mockResolvedValueOnce(null);
    await expect(updatePayee(actor, "x", base)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("schema checks PAN and email format", () => {
    expect(payeeSchema.safeParse({ ...base, pan: "abcde1234f" }).success).toBe(true);
    expect(payeeSchema.safeParse({ ...base, pan: "ABC" }).success).toBe(false);
    expect(payeeSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });
});

describe("purposes", () => {
  const rent = { code: "RENT", name: "Office Rent", purposeGroup: "EXPENDITURE" as const };

  it("validates the default expense account", async () => {
    await createExpensePurpose(actor, { ...rent, expenseAccountId: "acct-rent" });
    expect(assertValidExpenseAccount).toHaveBeenCalledWith("co-1", "acct-rent");
  });

  it("a sub-category must be in the same group and only one level deep", async () => {
    vi.mocked(FinanceConfigRepository.expensePurpose.findFirst)
      .mockResolvedValueOnce(null) // code check
      .mockResolvedValueOnce({ id: "p-loan", purposeGroup: "LOAN", parentId: null } as never);
    await expect(createExpensePurpose(actor, { ...rent, parentId: "p-loan" })).rejects.toThrow(/same group/);

    vi.mocked(FinanceConfigRepository.expensePurpose.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "p-child", purposeGroup: "EXPENDITURE", parentId: "p-root" } as never);
    await expect(createExpensePurpose(actor, { ...rent, parentId: "p-child" })).rejects.toThrow(/one level/);
  });

  it("can't be its own parent; group can't change while it has sub-categories", async () => {
    vi.mocked(FinanceConfigRepository.expensePurpose.findFirst).mockResolvedValue({ id: "pp-1", code: "RENT", purposeGroup: "EXPENDITURE" } as never);
    await expect(updateExpensePurpose(actor, "pp-1", { ...rent, parentId: "pp-1" })).rejects.toThrow(/own sub-category/);

    vi.mocked(FinanceConfigRepository.expensePurpose.count).mockResolvedValue(2);
    await expect(updateExpensePurpose(actor, "pp-1", { ...rent, purposeGroup: "VOUCHER" })).rejects.toThrow(/sub-categories/);
  });

  it("lists only active non-COGS expense accounts as {id, name}", async () => {
    vi.mocked(FinanceConfigRepository.chartOfAccount.findMany).mockResolvedValue([{ id: "a1", code: "EXP-RENT", name: "Rent" }] as never);
    await expect(listExpenseAccountOptions("co-1")).resolves.toEqual([{ id: "a1", name: "EXP-RENT — Rent" }]);
    expect(vi.mocked(FinanceConfigRepository.chartOfAccount.findMany).mock.calls[0][0]).toMatchObject({
      where: { companyId: "co-1", accountType: "EXPENSE", isActive: true, code: { not: "COGS" } },
    });
  });
});

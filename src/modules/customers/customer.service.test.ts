import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ advanceMasterCodeSequence: vi.fn() }));
vi.mock("./customer.repository", () => ({
  CustomerRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithBuyers: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  BuyerRepository: {
    findByCode: vi.fn(),
    findByIdForCustomer: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { CustomerRepository, BuyerRepository } = await import("./customer.repository");
const { createCustomer, updateCustomer, getCustomerById, updateBuyer } = await import("./customer.service");

const actor = { companyId: "co-1", userId: "user-1" };
const baseInput = {
  code: "CUST-00001",
  name: "Acme Garments",
  type: "CUSTOMER" as const,
  country: "India",
  isActive: true,
  paymentTermsDays: undefined,
  creditLimit: undefined,
  defaultCurrencyCode: "INR",
};

beforeEach(() => {
  vi.mocked(CustomerRepository.findByCode).mockReset();
  vi.mocked(CustomerRepository.create).mockReset();
  vi.mocked(CustomerRepository.update).mockReset();
  vi.mocked(CustomerRepository.findByIdWithBuyers).mockReset();
  vi.mocked(BuyerRepository.findByCode).mockReset();
  vi.mocked(BuyerRepository.findByIdForCustomer).mockReset();
  vi.mocked(BuyerRepository.update).mockReset();
});

describe("createCustomer", () => {
  it("rejects a duplicate code without ever touching the database's create call", async () => {
    vi.mocked(CustomerRepository.findByCode).mockResolvedValue({ id: "existing-id" } as never);

    await expect(createCustomer(actor, baseInput)).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(CustomerRepository.create).not.toHaveBeenCalled();
  });

  it("creates the customer when the code is free", async () => {
    vi.mocked(CustomerRepository.findByCode).mockResolvedValue(null);
    vi.mocked(CustomerRepository.create).mockResolvedValue({ id: "new-id", ...baseInput, companyId: "co-1" } as never);

    const result = await createCustomer(actor, baseInput);

    expect(result).toMatchObject({ id: "new-id" });
    expect(CustomerRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", code: "CUST-00001" })
    );
  });
});

describe("updateCustomer", () => {
  it("allows keeping the same code without a duplicate check against itself", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue({ id: "id-1", ...baseInput, buyers: [] } as never);
    vi.mocked(CustomerRepository.update).mockResolvedValue({ id: "id-1", ...baseInput } as never);

    await updateCustomer(actor, "id-1", baseInput);

    expect(CustomerRepository.findByCode).not.toHaveBeenCalled();
    expect(CustomerRepository.update).toHaveBeenCalled();
  });

  it("rejects renaming to a code already used by another customer", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue({
      id: "id-1",
      ...baseInput,
      code: "CUST-00001",
      buyers: [],
    } as never);
    vi.mocked(CustomerRepository.findByCode).mockResolvedValue({ id: "other-id" } as never);

    await expect(updateCustomer(actor, "id-1", { ...baseInput, code: "CUST-00002" })).rejects.toMatchObject({
      code: "DUPLICATE_DOC_NUMBER",
    });
    expect(CustomerRepository.update).not.toHaveBeenCalled();
  });
});

describe("getCustomerById", () => {
  it("throws NOT_FOUND when the repository returns nothing", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(null);
    await expect(getCustomerById("co-1", "missing-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// Regression tests for the P3 fix: Buyer previously had no update path at
// all (create-only), so a typo could never be fixed and it could never be
// deactivated despite `isActive` existing on the model since day one.
describe("updateBuyer", () => {
  it("rejects when the buyer doesn't exist for this customer", async () => {
    vi.mocked(BuyerRepository.findByIdForCustomer).mockResolvedValue(null);

    await expect(
      updateBuyer(actor, "cust-1", "buyer-missing", { code: "B1", name: "Buyer One" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(BuyerRepository.update).not.toHaveBeenCalled();
  });

  it("preserves the existing isActive value when omitted from the payload", async () => {
    vi.mocked(BuyerRepository.findByIdForCustomer).mockResolvedValue({
      id: "buyer-1",
      code: "B1",
      name: "Buyer One",
      isActive: false,
    } as never);
    vi.mocked(BuyerRepository.update).mockResolvedValue({ id: "buyer-1" } as never);

    await updateBuyer(actor, "cust-1", "buyer-1", { code: "B1", name: "Buyer One Renamed" } as never);

    expect(BuyerRepository.update).toHaveBeenCalledWith("buyer-1", expect.objectContaining({ isActive: false }));
  });

  it("applies an explicit isActive (the toggle's own flow)", async () => {
    vi.mocked(BuyerRepository.findByIdForCustomer).mockResolvedValue({
      id: "buyer-1",
      code: "B1",
      name: "Buyer One",
      isActive: true,
    } as never);
    vi.mocked(BuyerRepository.update).mockResolvedValue({ id: "buyer-1" } as never);

    await updateBuyer(actor, "cust-1", "buyer-1", { code: "B1", name: "Buyer One", isActive: false } as never);

    expect(BuyerRepository.update).toHaveBeenCalledWith("buyer-1", expect.objectContaining({ isActive: false }));
  });

  it("rejects renaming the code to one already used by another buyer on the same customer", async () => {
    vi.mocked(BuyerRepository.findByIdForCustomer).mockResolvedValue({
      id: "buyer-1",
      code: "B1",
      name: "Buyer One",
      isActive: true,
    } as never);
    vi.mocked(BuyerRepository.findByCode).mockResolvedValue({ id: "buyer-2" } as never);

    await expect(
      updateBuyer(actor, "cust-1", "buyer-1", { code: "B2", name: "Buyer One" } as never)
    ).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(BuyerRepository.update).not.toHaveBeenCalled();
  });
});

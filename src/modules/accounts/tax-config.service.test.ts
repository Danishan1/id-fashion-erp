import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./tax-config.repository", () => ({
  TaxTypeRepository: {
    findMany: vi.fn(),
    findAnyById: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  TaxRateRepository: {
    findMany: vi.fn(),
    findAnyById: vi.fn(),
    findActiveByTaxType: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { TaxTypeRepository, TaxRateRepository } = await import("./tax-config.repository");
const {
  listTaxTypes,
  createTaxType,
  updateTaxType,
  setTaxTypeActiveStatus,
  createTaxRate,
  updateTaxRate,
} = await import("./tax-config.service");

const actor = { companyId: "co-1", userId: "user-1" };
const rateInput = { taxTypeId: "tt-1", name: "GST 18%", ratePercentage: 18, effectiveFrom: "2026-01-01", effectiveTo: "" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();

  vi.mocked(TaxTypeRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(TaxTypeRepository.findAnyById).mockReset().mockResolvedValue({ id: "tt-1", code: "GST", name: "Goods & Services Tax", isActive: true } as never);
  vi.mocked(TaxTypeRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(TaxTypeRepository.create).mockReset().mockResolvedValue({ id: "tt-1", code: "GST", name: "Goods & Services Tax" } as never);
  vi.mocked(TaxTypeRepository.update).mockReset();

  vi.mocked(TaxRateRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(TaxRateRepository.findAnyById).mockReset().mockResolvedValue({ id: "rate-1", name: "GST 12%", ratePercentage: "12" } as never);
  vi.mocked(TaxRateRepository.findActiveByTaxType).mockReset().mockResolvedValue([]);
  vi.mocked(TaxRateRepository.create).mockReset().mockResolvedValue({ id: "rate-new" } as never);
  vi.mocked(TaxRateRepository.update).mockReset().mockResolvedValue({ id: "rate-1" } as never);
});

describe("Tax Type Operations (Financial Integrity & Tenant Scoping)", () => {
  it("lists tax types filtered by companyId", async () => {
    const list = [{ id: "tt-1", code: "GST", name: "GST", companyId: "co-1" }];
    vi.mocked(TaxTypeRepository.findMany).mockResolvedValue(list as never);

    const result = await listTaxTypes("co-1");
    expect(result).toEqual(list);
    expect(TaxTypeRepository.findMany).toHaveBeenCalledWith({ companyId: "co-1" });
  });

  it("creates a new tax type and writes audit log", async () => {
    const created = { id: "tt-2", code: "IGST", name: "Integrated GST", companyId: "co-1" };
    vi.mocked(TaxTypeRepository.create).mockResolvedValue(created as never);

    const result = await createTaxType(actor, { code: "IGST", name: "Integrated GST" });
    expect(result).toEqual(created);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        tableName: "tax_types",
        recordId: "tt-2",
        action: "CREATE",
      })
    );
  });

  it("rejects duplicate tax type code in the same company", async () => {
    vi.mocked(TaxTypeRepository.findByCode).mockResolvedValue({ id: "tt-old", code: "GST" } as never);

    await expect(createTaxType(actor, { code: "GST", name: "GST" })).rejects.toMatchObject({
      code: "DUPLICATE_DOC_NUMBER",
      message: 'Tax type code "GST" is already in use.',
    });
    expect(TaxTypeRepository.create).not.toHaveBeenCalled();
  });

  it("updates tax type with code change check", async () => {
    const existing = { id: "tt-1", code: "GST", name: "Old Name", isActive: true };
    const updated = { id: "tt-1", code: "GST-NEW", name: "Updated GST", isActive: true };
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(existing as never);
    vi.mocked(TaxTypeRepository.findByCode).mockResolvedValue(null);
    vi.mocked(TaxTypeRepository.update).mockResolvedValue(updated as never);

    const result = await updateTaxType(actor, "tt-1", { code: "GST-NEW", name: "Updated GST" });
    expect(result).toEqual(updated);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "tax_types",
        recordId: "tt-1",
        action: "UPDATE",
      })
    );
  });

  it("rejects updating tax type code if the new code is already in use by another tax type", async () => {
    const existing = { id: "tt-1", code: "GST", name: "GST", isActive: true };
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(existing as never);
    vi.mocked(TaxTypeRepository.findByCode).mockResolvedValue({ id: "tt-2", code: "IGST" } as never);

    await expect(updateTaxType(actor, "tt-1", { code: "IGST", name: "New IGST" })).rejects.toMatchObject({
      code: "DUPLICATE_DOC_NUMBER",
      message: 'Tax type code "IGST" is already in use.',
    });
  });

  it("throws NOT_FOUND when updating out-of-company tax type", async () => {
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(null);

    await expect(updateTaxType(actor, "tt-other", { code: "GST", name: "GST" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Tax type not found.",
    });
  });

  it("updates tax type active status and writes audit log", async () => {
    const existing = { id: "tt-1", code: "GST", name: "GST", isActive: true };
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(existing as never);
    vi.mocked(TaxTypeRepository.update).mockResolvedValue({ ...existing, isActive: false } as never);

    const result = await setTaxTypeActiveStatus(actor, "tt-1", false);
    expect(result.isActive).toBe(false);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "tax_types",
        action: "UPDATE",
        newValues: { isActive: false },
      })
    );
  });
});

describe("Tax Rate Operations & Overlap Invariants (Financial Integrity)", () => {
  it("rejects a taxTypeId belonging to another company on create", async () => {
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(null);
    await expect(createTaxRate(actor, rateInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(TaxRateRepository.create).not.toHaveBeenCalled();
  });

  it("rejects effectiveTo date when it is on or before effectiveFrom", async () => {
    await expect(
      createTaxRate(actor, {
        taxTypeId: "tt-1",
        name: "GST 18%",
        ratePercentage: 18,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-05-01", // before effectiveFrom
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Effective-to date must be after the effective-from date.",
    });
  });

  it("rejects creating a tax rate that overlaps an existing open-ended rate", async () => {
    vi.mocked(TaxRateRepository.findActiveByTaxType).mockResolvedValue([
      {
        id: "rate-open",
        name: "Current GST 18%",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null, // open-ended (+Infinity)
      } as never,
    ]);

    // Candidate rate [2026-06-01, 2026-12-31) overlaps the open-ended rate starting 2026-01-01
    await expect(
      createTaxRate(actor, {
        taxTypeId: "tt-1",
        name: "Overlap Rate",
        ratePercentage: 12,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-12-31",
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("overlaps an existing active rate"),
    });
  });

  it("allows creating a tax rate when date range does not overlap existing rate", async () => {
    vi.mocked(TaxRateRepository.findActiveByTaxType).mockResolvedValue([
      {
        id: "rate-current",
        name: "Current GST 18%",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
      } as never,
    ]);

    // Candidate rate [2025-01-01, 2025-12-31) is completely before 2026-01-01 (half-open range [2025, 2025-12-31) < 2026-01-01)
    await createTaxRate(actor, {
      taxTypeId: "tt-1",
      name: "Past Year GST",
      ratePercentage: 12,
      effectiveFrom: "2025-01-01",
      effectiveTo: "2025-12-31",
    });

    expect(TaxRateRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Past Year GST",
        ratePercentage: 12,
      })
    );
  });

  it("rejects a taxTypeId belonging to another company on update", async () => {
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(null);
    await expect(updateTaxRate(actor, "rate-1", rateInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(TaxRateRepository.update).not.toHaveBeenCalled();
  });

  it("succeeds when the taxTypeId belongs to this company and range is valid", async () => {
    await updateTaxRate(actor, "rate-1", rateInput as never);
    expect(TaxRateRepository.update).toHaveBeenCalledWith("rate-1", expect.objectContaining({ taxTypeId: "tt-1" }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ advanceMasterCodeSequence: vi.fn() }));
vi.mock("@/modules/garment-attributes/garment-attributes.repository", () => ({
  GarmentAttributeRepository: { supplierCategory: { findFirst: vi.fn() } },
}));
vi.mock("./supplier.repository", () => ({
  SupplierRepository: {
    findByCode: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { GarmentAttributeRepository } = await import("@/modules/garment-attributes/garment-attributes.repository");
const { SupplierRepository } = await import("./supplier.repository");
const { createSupplier, updateSupplier } = await import("./supplier.service");

const actor = { companyId: "co-1", userId: "user-1" };
const baseInput = { code: "SUP100", name: "New Supplier", isActive: true };

beforeEach(() => {
  vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockReset();
  vi.mocked(SupplierRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(SupplierRepository.findById).mockReset();
  vi.mocked(SupplierRepository.create).mockReset();
  vi.mocked(SupplierRepository.update).mockReset();
});

describe("createSupplier — categoryId validation", () => {
  it("rejects a categoryId that doesn't belong to a real category in this company", async () => {
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValue(null as never);

    await expect(createSupplier(actor, { ...baseInput, categoryId: "cat-1" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierRepository.create).not.toHaveBeenCalled();
  });

  it("creates successfully when categoryId points at a real supplier category", async () => {
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValue({ id: "cat-1", name: "Fabric" } as never);
    vi.mocked(SupplierRepository.create).mockResolvedValue({ id: "sup-new" } as never);

    await createSupplier(actor, { ...baseInput, categoryId: "cat-1" } as never);

    expect(GarmentAttributeRepository.supplierCategory.findFirst).toHaveBeenCalledWith({ where: { id: "cat-1", companyId: "co-1" } });
    expect(SupplierRepository.create).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "cat-1" }));
  });
});

describe("updateSupplier — categoryId validation", () => {
  it("rejects reassigning to a categoryId from another tenant", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue({ id: "sup-1", code: "SUP001" } as never);
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValue(null as never);

    await expect(updateSupplier(actor, "sup-1", { categoryId: "cat-other-tenant" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierRepository.update).not.toHaveBeenCalled();
  });

  it("skips the check entirely when categoryId isn't part of the update", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue({ id: "sup-1", code: "SUP001" } as never);
    vi.mocked(SupplierRepository.update).mockResolvedValue({ id: "sup-1" } as never);

    await updateSupplier(actor, "sup-1", { name: "Renamed Supplier" } as never);

    expect(GarmentAttributeRepository.supplierCategory.findFirst).not.toHaveBeenCalled();
    expect(SupplierRepository.update).toHaveBeenCalled();
  });
});

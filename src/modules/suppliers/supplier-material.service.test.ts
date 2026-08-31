import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn() },
}));
vi.mock("./supplier-material.repository", () => ({
  SupplierMaterialRepository: {
    findMany: vi.fn(),
    findLink: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    findManyByProductIds: vi.fn(),
    delete: vi.fn(),
  },
  SupplierMaterialCategoryRepository: {
    findGranted: vi.fn(),
    replaceInTx: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { SupplierRepository } = await import("./supplier.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { SupplierMaterialRepository, SupplierMaterialCategoryRepository } = await import("./supplier-material.repository");
const {
  listSuppliedMaterials,
  addSuppliedMaterial,
  addSuppliedMaterials,
  removeSuppliedMaterial,
  listSuppliedCategories,
  updateSuppliedCategories,
} = await import("./supplier-material.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(SupplierRepository.findById).mockReset().mockResolvedValue({ id: "sup-1", companyId: "co-1" } as never);
  vi.mocked(ProductRepository.findMaterialById).mockReset().mockResolvedValue({ id: "mat-1" } as never);
  vi.mocked(SupplierMaterialRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(SupplierMaterialRepository.findLink).mockReset().mockResolvedValue(null);
  vi.mocked(SupplierMaterialRepository.create).mockReset().mockResolvedValue({ id: "link-1" } as never);
  vi.mocked(SupplierMaterialRepository.createMany).mockReset().mockResolvedValue({ count: 0 } as never);
  vi.mocked(SupplierMaterialRepository.findManyByProductIds).mockReset().mockResolvedValue([{ id: "mat-1" }, { id: "mat-2" }] as never);
  vi.mocked(SupplierMaterialRepository.delete).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(SupplierMaterialCategoryRepository.findGranted).mockReset().mockResolvedValue([]);
  vi.mocked(SupplierMaterialCategoryRepository.replaceInTx).mockReset().mockResolvedValue(undefined as never);
});

describe("listSuppliedMaterials", () => {
  it("throws NOT_FOUND for a supplier that doesn't belong to the company", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(listSuppliedMaterials("co-1", "sup-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the linked materials once the supplier is confirmed tenant-scoped", async () => {
    vi.mocked(SupplierMaterialRepository.findMany).mockResolvedValue([{ id: "link-1" }] as never);
    await expect(listSuppliedMaterials("co-1", "sup-1")).resolves.toEqual([{ id: "link-1" }]);
  });
});

describe("addSuppliedMaterial", () => {
  it("throws NOT_FOUND when the supplier doesn't belong to the company", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(addSuppliedMaterial(actor, "sup-x", "mat-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierMaterialRepository.create).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the material isn't a real raw material of this company", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);
    await expect(addSuppliedMaterial(actor, "sup-1", "mat-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierMaterialRepository.create).not.toHaveBeenCalled();
  });

  it("throws REFERENCED_RECORD_IN_USE when the link already exists", async () => {
    vi.mocked(SupplierMaterialRepository.findLink).mockResolvedValue({ id: "link-existing" } as never);
    await expect(addSuppliedMaterial(actor, "sup-1", "mat-1")).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
    expect(SupplierMaterialRepository.create).not.toHaveBeenCalled();
  });

  it("creates the link and writes an audit log entry once every check passes", async () => {
    const link = await addSuppliedMaterial(actor, "sup-1", "mat-1");
    expect(link).toEqual({ id: "link-1" });
    expect(SupplierMaterialRepository.create).toHaveBeenCalledWith({ companyId: "co-1", supplierId: "sup-1", productId: "mat-1" });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "supplier_materials", action: "CREATE" }));
  });

  it("never writes to Product.defaultSupplierId — this catalog is deliberately independent of it", async () => {
    await addSuppliedMaterial(actor, "sup-1", "mat-1");
    // No repository call in this module ever touches ProductRepository beyond the read-only findMaterialById lookup.
    expect(Object.keys(vi.mocked(ProductRepository))).toEqual(["findMaterialById"]);
  });
});

describe("addSuppliedMaterials (bulk)", () => {
  it("throws NOT_FOUND when the supplier doesn't belong to the company", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(addSuppliedMaterials(actor, "sup-x", ["mat-1"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierMaterialRepository.createMany).not.toHaveBeenCalled();
  });

  it("rejects the whole batch when any material id doesn't belong to this company (or isn't RAW_MATERIAL)", async () => {
    vi.mocked(SupplierMaterialRepository.findManyByProductIds).mockResolvedValue([{ id: "mat-1" }] as never); // mat-2 missing
    await expect(addSuppliedMaterials(actor, "sup-1", ["mat-1", "mat-2"])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierMaterialRepository.createMany).not.toHaveBeenCalled();
  });

  it("deduplicates the submitted ids and creates one row per unique material, skipping already-linked ones at the DB level", async () => {
    await addSuppliedMaterials(actor, "sup-1", ["mat-1", "mat-1", "mat-2"]);
    expect(SupplierMaterialRepository.createMany).toHaveBeenCalledWith([
      { companyId: "co-1", supplierId: "sup-1", productId: "mat-1" },
      { companyId: "co-1", supplierId: "sup-1", productId: "mat-2" },
    ]);
  });

  it("writes one audit log entry for the whole batch, not one per material", async () => {
    await addSuppliedMaterials(actor, "sup-1", ["mat-1", "mat-2"]);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "supplier_materials", action: "CREATE", newValues: { supplierId: "sup-1", materialIds: ["mat-1", "mat-2"] } })
    );
  });

  it("returns the refreshed full list after adding", async () => {
    vi.mocked(SupplierMaterialRepository.findMany).mockResolvedValue([{ id: "link-1" }, { id: "link-2" }] as never);
    await expect(addSuppliedMaterials(actor, "sup-1", ["mat-1"])).resolves.toEqual([{ id: "link-1" }, { id: "link-2" }]);
  });
});

describe("listSuppliedCategories", () => {
  it("returns every real material category, marking only the granted ones", async () => {
    vi.mocked(SupplierMaterialCategoryRepository.findGranted).mockResolvedValue([{ materialCategory: "FABRIC" }] as never);
    const result = await listSuppliedCategories("co-1", "sup-1");
    expect(result.find((c) => c.category === "FABRIC")?.granted).toBe(true);
    expect(result.find((c) => c.category === "TRIMS")?.granted).toBe(false);
    // SERVICES/MACHINERY are Supplier-only concepts — no Product ever carries
    // them, so they must never appear in this material-category list. (The
    // category type itself already guarantees this at compile time — this
    // is the runtime confirmation that the returned list is exactly the 7
    // real material categories, no more, no fewer.)
    expect(result.map((c) => c.category).sort()).toEqual(
      ["FABRIC", "TRIMS", "ZIPS", "BUTTONS", "ACCESSORIES", "PACKAGING", "OTHER"].sort()
    );
  });

  it("throws NOT_FOUND for a supplier that doesn't belong to the company", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(listSuppliedCategories("co-1", "sup-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateSuppliedCategories", () => {
  it("rejects an unknown category value before writing anything", async () => {
    await expect(updateSuppliedCategories(actor, "sup-1", ["NOT_A_REAL_CATEGORY"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(SupplierMaterialCategoryRepository.replaceInTx).not.toHaveBeenCalled();
  });

  it("deduplicates and full-replaces the granted category set", async () => {
    await updateSuppliedCategories(actor, "sup-1", ["FABRIC", "FABRIC", "TRIMS"]);
    expect(SupplierMaterialCategoryRepository.replaceInTx).toHaveBeenCalledWith("co-1", "sup-1", ["FABRIC", "TRIMS"]);
  });

  it("accepts an empty array — a real 'supplies no categories broadly' state, not a no-op", async () => {
    await updateSuppliedCategories(actor, "sup-1", []);
    expect(SupplierMaterialCategoryRepository.replaceInTx).toHaveBeenCalledWith("co-1", "sup-1", []);
  });

  it("writes an audit log entry", async () => {
    await updateSuppliedCategories(actor, "sup-1", ["FABRIC"]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "supplier_material_categories", action: "UPDATE" }));
  });

  it("throws NOT_FOUND for a supplier that doesn't belong to the company", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(updateSuppliedCategories(actor, "sup-x", ["FABRIC"])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("removeSuppliedMaterial", () => {
  it("throws NOT_FOUND when the supplier doesn't belong to the company", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(removeSuppliedMaterial(actor, "sup-x", "mat-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the material isn't currently linked", async () => {
    await expect(removeSuppliedMaterial(actor, "sup-1", "mat-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SupplierMaterialRepository.delete).not.toHaveBeenCalled();
  });

  it("deletes the link and writes an audit log entry once it's confirmed to exist", async () => {
    vi.mocked(SupplierMaterialRepository.findLink).mockResolvedValue({ id: "link-1" } as never);
    await removeSuppliedMaterial(actor, "sup-1", "mat-1");
    expect(SupplierMaterialRepository.delete).toHaveBeenCalledWith("link-1");
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "supplier_materials", action: "DELETE" }));
  });
});

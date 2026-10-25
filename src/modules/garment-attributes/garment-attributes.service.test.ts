import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./garment-attributes.repository", () => ({
  GarmentAttributeRepository: {
    brand: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    category: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    season: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    productFitting: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    productType: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    design: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    designPattern: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pattern: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    supplierCategory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { GarmentAttributeRepository } = await import("./garment-attributes.repository");
const {
  listBrands,
  createBrand,
  updateBrand,
  listCategories,
  createCategory,
  updateCategory,
} = await import("./garment-attributes.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();

  vi.mocked(GarmentAttributeRepository.brand.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(GarmentAttributeRepository.brand.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(GarmentAttributeRepository.brand.create).mockReset();
  vi.mocked(GarmentAttributeRepository.brand.update).mockReset();

  vi.mocked(GarmentAttributeRepository.category.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(GarmentAttributeRepository.category.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(GarmentAttributeRepository.category.create).mockReset();
  vi.mocked(GarmentAttributeRepository.category.update).mockReset();

  vi.mocked(GarmentAttributeRepository.season.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(GarmentAttributeRepository.season.create).mockReset();
});

describe("Garment Attributes Service (Unit Tests)", () => {
  describe("Generic Attribute Operations (Brand, Season, etc.)", () => {
    it("lists brands for company ordered by name asc", async () => {
      const records = [{ id: "b-1", code: "ZARA", name: "Zara", companyId: "co-1" }];
      vi.mocked(GarmentAttributeRepository.brand.findMany).mockResolvedValue(records as never);

      const result = await listBrands("co-1");
      expect(result).toEqual(records);
      expect(GarmentAttributeRepository.brand.findMany).toHaveBeenCalledWith({
        where: { companyId: "co-1" },
        orderBy: { name: "asc" },
      });
    });

    it("creates brand and writes audit log", async () => {
      const created = { id: "b-1", code: "LEVIS", name: "Levi's", isActive: true, companyId: "co-1" };
      vi.mocked(GarmentAttributeRepository.brand.create).mockResolvedValue(created as never);

      const result = await createBrand(actor, { code: "LEVIS", name: "Levi's", isActive: true });
      expect(result).toEqual(created);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "brands",
          recordId: "b-1",
          action: "CREATE",
        })
      );
    });

    it("rejects duplicate brand code within the same company", async () => {
      vi.mocked(GarmentAttributeRepository.brand.findFirst).mockResolvedValue({ id: "b-old", code: "LEVIS" } as never);

      await expect(
        createBrand(actor, { code: "LEVIS", name: "Levi's", isActive: true })
      ).rejects.toMatchObject({
        code: "DUPLICATE_DOC_NUMBER",
        message: 'Brand code "LEVIS" is already in use.',
      });
    });

    it("updates brand and writes audit log", async () => {
      const existing = { id: "b-1", code: "LEVIS", name: "Old", isActive: true, companyId: "co-1" };
      const updated = { ...existing, name: "Levi Strauss" };
      vi.mocked(GarmentAttributeRepository.brand.findFirst).mockResolvedValue(existing as never);
      vi.mocked(GarmentAttributeRepository.brand.update).mockResolvedValue(updated as never);

      const result = await updateBrand(actor, "b-1", { code: "LEVIS", name: "Levi Strauss", isActive: true });
      expect(result).toEqual(updated);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "brands",
          action: "UPDATE",
        })
      );
    });

    it("throws NOT_FOUND when updating out-of-company brand (tenant isolation)", async () => {
      vi.mocked(GarmentAttributeRepository.brand.findFirst).mockResolvedValue(null);

      await expect(
        updateBrand(actor, "b-other", { code: "LEVIS", name: "Levi's", isActive: true })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Brand not found.",
      });
    });
  });

  describe("Category Operations & Ancestor Hierarchy", () => {
    it("lists categories for company ordered by name asc", async () => {
      const cats = [{ id: "cat-1", code: "MENS", name: "Men's Apparel", companyId: "co-1" }];
      vi.mocked(GarmentAttributeRepository.category.findMany).mockResolvedValue(cats as never);

      const result = await listCategories("co-1");
      expect(result).toEqual(cats);
    });

    it("creates root category when parentCategoryId is omitted or null", async () => {
      const created = { id: "cat-1", code: "MENS", name: "Men's Apparel", parentCategoryId: null, isActive: true, companyId: "co-1" };
      vi.mocked(GarmentAttributeRepository.category.create).mockResolvedValue(created as never);

      const result = await createCategory(actor, { code: "MENS", name: "Men's Apparel", isActive: true });
      expect(result).toEqual(created);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tableName: "categories",
          recordId: "cat-1",
          action: "CREATE",
        })
      );
    });

    it("creates child category when parent category exists in the company", async () => {
      vi.mocked(GarmentAttributeRepository.category.findFirst)
        .mockResolvedValueOnce(null) // code check
        .mockResolvedValueOnce({ id: "cat-parent", parentCategoryId: null } as never); // parent check

      const created = { id: "cat-2", code: "SHIRTS", name: "Shirts", parentCategoryId: "cat-parent", isActive: true, companyId: "co-1" };
      vi.mocked(GarmentAttributeRepository.category.create).mockResolvedValue(created as never);

      const result = await createCategory(actor, { code: "SHIRTS", name: "Shirts", parentCategoryId: "cat-parent", isActive: true });
      expect(result).toEqual(created);
    });

    it("rejects creating category if parent category does not exist in the company", async () => {
      vi.mocked(GarmentAttributeRepository.category.findFirst)
        .mockResolvedValueOnce(null) // code check
        .mockResolvedValueOnce(null); // parent check

      await expect(
        createCategory(actor, { code: "SHIRTS", name: "Shirts", parentCategoryId: "cat-foreign", isActive: true })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Parent category not found.",
      });
    });

    it("rejects updating a category to be its own parent", async () => {
      vi.mocked(GarmentAttributeRepository.category.findFirst).mockResolvedValue({ id: "cat-1", companyId: "co-1" } as never);

      await expect(
        updateCategory(actor, "cat-1", { code: "MENS", name: "Men", parentCategoryId: "cat-1", isActive: true })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "A category cannot be its own parent.",
      });
    });

    it("rejects creating cyclic ancestor hierarchy (cannot set parent to its own descendant)", async () => {
      // cat-1 is parent of cat-2; now someone tries to set cat-1's parent to cat-2
      vi.mocked(GarmentAttributeRepository.category.findFirst)
        .mockResolvedValueOnce({ id: "cat-1", companyId: "co-1" } as never) // existing check
        .mockResolvedValueOnce({ id: "cat-2", parentCategoryId: "cat-1" } as never) // hop 1: cat-2's parent is cat-1
        .mockResolvedValueOnce({ id: "cat-1", parentCategoryId: null } as never); // hop 2: reaches cat-1!

      await expect(
        updateCategory(actor, "cat-1", { code: "MENS", name: "Men", parentCategoryId: "cat-2", isActive: true })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Cannot set a category's parent to one of its own descendants.",
      });
    });
  });
});

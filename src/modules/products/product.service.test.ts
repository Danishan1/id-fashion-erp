import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./product.repository", () => ({
  ProductRepository: { findManyStyles: vi.fn(), count: vi.fn(), findStyleById: vi.fn() },
  ProductVariantRepository: {
    findColorsByIds: vi.fn(),
    findSizesByIds: vi.fn(),
    findExistingKeys: vi.fn(),
    createMany: vi.fn(),
  },
}));

const { ProductRepository, ProductVariantRepository } = await import("./product.repository");
const { listProducts, generateVariants } = await import("./product.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseQuery = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "styleName", sortOrder: "asc" as const };

beforeEach(() => {
  vi.mocked(ProductRepository.findManyStyles).mockReset().mockResolvedValue([]);
  vi.mocked(ProductRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(ProductRepository.findStyleById).mockReset().mockResolvedValue({ id: "prod-1", styleCode: "ST-001" } as never);
  vi.mocked(ProductVariantRepository.findColorsByIds).mockReset();
  vi.mocked(ProductVariantRepository.findSizesByIds).mockReset();
  vi.mocked(ProductVariantRepository.findExistingKeys).mockReset().mockResolvedValue(new Set());
  vi.mocked(ProductVariantRepository.createMany).mockReset();
});

describe("listProducts filters", () => {
  it("applies no extra filter fields when none are given, matching the original search-only behavior", async () => {
    await listProducts("co-1", { ...baseQuery, search: "shirt" });
    const where = vi.mocked(ProductRepository.findManyStyles).mock.calls[0][0];
    expect(where).toMatchObject({ companyId: "co-1", itemType: "STYLE", deletedAt: null });
    expect(where).not.toHaveProperty("categoryId");
    expect(where).not.toHaveProperty("brandId");
  });

  it("applies a single filter field", async () => {
    await listProducts("co-1", baseQuery, { brandId: "brand-1" });
    const where = vi.mocked(ProductRepository.findManyStyles).mock.calls[0][0];
    expect(where).toMatchObject({ brandId: "brand-1" });
  });

  it("combines every filter field together", async () => {
    await listProducts("co-1", baseQuery, {
      categoryId: "cat-1",
      seasonId: "season-1",
      brandId: "brand-1",
      productTypeId: "type-1",
      productFittingId: "fit-1",
      isActive: true,
    });
    const where = vi.mocked(ProductRepository.findManyStyles).mock.calls[0][0];
    expect(where).toMatchObject({
      categoryId: "cat-1",
      seasonId: "season-1",
      brandId: "brand-1",
      productTypeId: "type-1",
      productFittingId: "fit-1",
      isActive: true,
    });
  });

  it("distinguishes isActive: false from isActive omitted", async () => {
    await listProducts("co-1", baseQuery, { isActive: false });
    const where = vi.mocked(ProductRepository.findManyStyles).mock.calls[0][0];
    expect(where).toMatchObject({ isActive: false });

    await listProducts("co-1", baseQuery, {});
    const where2 = vi.mocked(ProductRepository.findManyStyles).mock.calls[1][0];
    expect(where2).not.toHaveProperty("isActive");
  });
});

describe("generateVariants", () => {
  // Regression test for the P3 fix: bulk variant generation previously
  // accepted any color/size id belonging to the company with no isActive
  // check at all, letting a deactivated master be used in a brand-new
  // transaction — inconsistent with the "inactive masters can't be picked
  // for new business" pattern already enforced elsewhere.
  it("rejects generating variants with a deactivated color", async () => {
    vi.mocked(ProductVariantRepository.findColorsByIds).mockResolvedValue([
      { id: "color-1", name: "Retired Red", isActive: false },
    ] as never);
    vi.mocked(ProductVariantRepository.findSizesByIds).mockResolvedValue([{ id: "size-1", name: "Medium", isActive: true }] as never);

    await expect(
      generateVariants(actor, "prod-1", { colorIds: ["color-1"], sizeIds: ["size-1"] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(ProductVariantRepository.createMany).not.toHaveBeenCalled();
  });

  it("rejects generating variants with a deactivated size", async () => {
    vi.mocked(ProductVariantRepository.findColorsByIds).mockResolvedValue([{ id: "color-1", name: "Black", isActive: true }] as never);
    vi.mocked(ProductVariantRepository.findSizesByIds).mockResolvedValue([
      { id: "size-1", name: "Retired Size", isActive: false },
    ] as never);

    await expect(
      generateVariants(actor, "prod-1", { colorIds: ["color-1"], sizeIds: ["size-1"] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(ProductVariantRepository.createMany).not.toHaveBeenCalled();
  });

  it("still generates variants normally when every color and size is active", async () => {
    vi.mocked(ProductVariantRepository.findColorsByIds).mockResolvedValue([{ id: "color-1", code: "BLK", name: "Black", isActive: true }] as never);
    vi.mocked(ProductVariantRepository.findSizesByIds).mockResolvedValue([{ id: "size-1", code: "M", name: "Medium", isActive: true }] as never);

    const result = await generateVariants(actor, "prod-1", { colorIds: ["color-1"], sizeIds: ["size-1"] });

    expect(result).toEqual({ created: 1 });
    expect(ProductVariantRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ productId: "prod-1", colorId: "color-1", sizeId: "size-1" }),
    ]);
  });
});

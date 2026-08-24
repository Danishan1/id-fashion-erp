import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./product.repository", () => ({
  ProductRepository: { findManyStyles: vi.fn(), count: vi.fn() },
  ProductVariantRepository: {},
}));

const { ProductRepository } = await import("./product.repository");
const { listProducts } = await import("./product.service");

const baseQuery = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "styleName", sortOrder: "asc" as const };

beforeEach(() => {
  vi.mocked(ProductRepository.findManyStyles).mockReset().mockResolvedValue([]);
  vi.mocked(ProductRepository.count).mockReset().mockResolvedValue(0);
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

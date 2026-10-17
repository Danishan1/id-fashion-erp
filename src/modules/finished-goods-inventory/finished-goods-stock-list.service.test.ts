import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-stock-list.repository", () => ({
  FinishedGoodsStockListRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

const { FinishedGoodsStockListRepository } = await import("./finished-goods-stock-list.repository");
const { listFinishedGoodsStockBalances } = await import("./finished-goods-stock-list.service");

const baseQuery = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "updatedAt", sortOrder: "desc" as const };

beforeEach(() => {
  vi.mocked(FinishedGoodsStockListRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(FinishedGoodsStockListRepository.count).mockReset().mockResolvedValue(0);
});

describe("listFinishedGoodsStockBalances (FGI-051)", () => {
  it("scopes every query to the actor's own company, with no other filters when none are supplied", async () => {
    await listFinishedGoodsStockBalances("co-1", baseQuery);

    const whereArg = vi.mocked(FinishedGoodsStockListRepository.findMany).mock.calls[0][0];
    expect(whereArg).toEqual({ companyId: "co-1" });
  });

  it("adds a style-name/style-code search filter when query.search is supplied", async () => {
    await listFinishedGoodsStockBalances("co-1", { ...baseQuery, search: "tee" });

    const whereArg = vi.mocked(FinishedGoodsStockListRepository.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect(whereArg.product).toEqual({
      OR: [
        { styleName: { contains: "tee", mode: "insensitive" } },
        { styleCode: { contains: "tee", mode: "insensitive" } },
      ],
    });
  });

  it("filters by productId, warehouseId, and warehouseLocationId as plain equality filters", async () => {
    await listFinishedGoodsStockBalances("co-1", baseQuery, {
      productId: "prod-1",
      warehouseId: "wh-1",
      warehouseLocationId: "loc-1",
    });

    expect(FinishedGoodsStockListRepository.findMany).toHaveBeenCalledWith(
      { companyId: "co-1", productId: "prod-1", warehouseId: "wh-1", warehouseLocationId: "loc-1" },
      expect.anything()
    );
  });

  it("filters by colour and size via a nested productVariant filter", async () => {
    await listFinishedGoodsStockBalances("co-1", baseQuery, { colorId: "color-1", sizeId: "size-1" });

    expect(FinishedGoodsStockListRepository.findMany).toHaveBeenCalledWith(
      { companyId: "co-1", productVariant: { colorId: "color-1", sizeId: "size-1" } },
      expect.anything()
    );
  });

  it("accepts a valid stockStatus query value", async () => {
    await listFinishedGoodsStockBalances("co-1", { ...baseQuery, status: "REJECTED" });

    expect(FinishedGoodsStockListRepository.findMany).toHaveBeenCalledWith(
      { companyId: "co-1", stockStatus: "REJECTED" },
      expect.anything()
    );
  });

  it("silently ignores an invalid stockStatus value rather than passing it through to Prisma unvalidated", async () => {
    await listFinishedGoodsStockBalances("co-1", { ...baseQuery, status: "NOT_A_REAL_STATUS" });

    const whereArg = vi.mocked(FinishedGoodsStockListRepository.findMany).mock.calls[0][0];
    expect(whereArg).toEqual({ companyId: "co-1" });
  });

  it("returns the repository's rows and total count unchanged", async () => {
    vi.mocked(FinishedGoodsStockListRepository.findMany).mockResolvedValue([{ id: "row-1" }] as never);
    vi.mocked(FinishedGoodsStockListRepository.count).mockResolvedValue(1);

    const result = await listFinishedGoodsStockBalances("co-1", baseQuery);

    expect(result).toEqual({ data: [{ id: "row-1" }], totalCount: 1 });
  });
});

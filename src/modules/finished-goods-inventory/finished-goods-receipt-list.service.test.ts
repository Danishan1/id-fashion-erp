import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-receipt-list.repository", () => ({
  FinishedGoodsReceiptListRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
  },
}));

const { FinishedGoodsReceiptListRepository } = await import("./finished-goods-receipt-list.repository");
const { listFinishedGoodsReceipts, getFinishedGoodsReceiptById } = await import("./finished-goods-receipt-list.service");

const baseQuery = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "postedAt", sortOrder: "desc" as const };

beforeEach(() => {
  vi.mocked(FinishedGoodsReceiptListRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(FinishedGoodsReceiptListRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(FinishedGoodsReceiptListRepository.findById).mockReset().mockResolvedValue(null);
});

describe("listFinishedGoodsReceipts (FGI-053)", () => {
  it("scopes every query to the actor's own company, with no other filters when none are supplied", async () => {
    await listFinishedGoodsReceipts("co-1", baseQuery);

    const whereArg = vi.mocked(FinishedGoodsReceiptListRepository.findMany).mock.calls[0][0];
    expect(whereArg).toEqual({ companyId: "co-1" });
  });

  it("adds a receipt-number/style-name/style-code search filter when query.search is supplied", async () => {
    await listFinishedGoodsReceipts("co-1", { ...baseQuery, search: "jeans" });

    const whereArg = vi.mocked(FinishedGoodsReceiptListRepository.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect(whereArg.OR).toEqual([
      { receiptNumber: { contains: "jeans", mode: "insensitive" } },
      { product: { styleName: { contains: "jeans", mode: "insensitive" } } },
      { product: { styleCode: { contains: "jeans", mode: "insensitive" } } },
    ]);
  });

  it("filters by productId and warehouseId as plain equality filters", async () => {
    await listFinishedGoodsReceipts("co-1", baseQuery, { productId: "prod-1", warehouseId: "wh-1" });

    expect(FinishedGoodsReceiptListRepository.findMany).toHaveBeenCalledWith(
      { companyId: "co-1", productId: "prod-1", warehouseId: "wh-1" },
      expect.anything()
    );
  });

  it("returns the repository's rows and total count unchanged", async () => {
    vi.mocked(FinishedGoodsReceiptListRepository.findMany).mockResolvedValue([{ id: "rcpt-1" }] as never);
    vi.mocked(FinishedGoodsReceiptListRepository.count).mockResolvedValue(1);

    const result = await listFinishedGoodsReceipts("co-1", baseQuery);

    expect(result).toEqual({ data: [{ id: "rcpt-1" }], totalCount: 1 });
  });
});

describe("getFinishedGoodsReceiptById (FGI-053)", () => {
  it("throws NOT_FOUND for a missing or wrong-company receipt id", async () => {
    await expect(getFinishedGoodsReceiptById("co-1", "rcpt-x")).rejects.toThrow("Finished Goods receipt not found.");
  });

  it("returns the repository's receipt unchanged when found", async () => {
    vi.mocked(FinishedGoodsReceiptListRepository.findById).mockResolvedValue({ id: "rcpt-1", receiptNumber: "FGR-2026-00001" } as never);

    const result = await getFinishedGoodsReceiptById("co-1", "rcpt-1");

    expect(result).toEqual({ id: "rcpt-1", receiptNumber: "FGR-2026-00001" });
    expect(FinishedGoodsReceiptListRepository.findById).toHaveBeenCalledWith("co-1", "rcpt-1");
  });
});

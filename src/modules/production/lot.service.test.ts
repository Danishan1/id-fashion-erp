import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("./production.repository", () => ({
  LotRepository: {
    findAnyById: vi.fn(),
    countOpenJobOrders: vi.fn(),
    createInTx: vi.fn(),
    updateInTx: vi.fn(),
  },
  LotRelationRepository: { createManyInTx: vi.fn() },
  ProductionOrderRepository: { findAnyById: vi.fn(), incrementLotSequenceInTx: vi.fn() },
}));

const { LotRepository, ProductionOrderRepository } = await import("./production.repository");
const { splitLot, mergeLots } = await import("./lot.service");

const actor = { companyId: "co-1", userId: "user-1" };

function lot(overrides: Record<string, unknown> = {}) {
  return {
    id: "lot-1",
    companyId: "co-1",
    productionOrderId: "po-1",
    lotNumber: "PROD-1-L01",
    quantity: "1000",
    uomId: "uom-1",
    status: "PLANNED",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(LotRepository.findAnyById).mockReset();
  vi.mocked(LotRepository.countOpenJobOrders).mockReset().mockResolvedValue(0);
  vi.mocked(ProductionOrderRepository.findAnyById).mockReset().mockResolvedValue({ id: "po-1", orderNumber: "PROD-2026-00001" } as never);
});

describe("splitLot", () => {
  it("rejects when child quantities don't sum to exactly the parent's quantity", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValue(lot({ quantity: "1000" }) as never);

    await expect(splitLot(actor, "lot-1", { children: [{ quantity: 600 }, { quantity: 300 }] })).rejects.toMatchObject({
      code: "LOT_GENEALOGY_INVALID",
    });
  });

  it("rejects splitting a lot that already has an open job order", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValue(lot({ quantity: "1000", status: "IN_PROGRESS" }) as never);
    vi.mocked(LotRepository.countOpenJobOrders).mockResolvedValue(1);

    await expect(splitLot(actor, "lot-1", { children: [{ quantity: 600 }, { quantity: 400 }] })).rejects.toMatchObject({
      code: "LOT_GENEALOGY_INVALID",
    });
  });

  it("rejects splitting an already-terminal lot", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValue(lot({ status: "SPLIT" }) as never);

    await expect(splitLot(actor, "lot-1", { children: [{ quantity: 600 }, { quantity: 400 }] })).rejects.toMatchObject({
      code: "LOT_GENEALOGY_INVALID",
    });
  });
});

describe("mergeLots", () => {
  it("rejects merging lots from different production orders", async () => {
    vi.mocked(LotRepository.findAnyById)
      .mockResolvedValueOnce(lot({ id: "lot-a", productionOrderId: "po-1" }) as never)
      .mockResolvedValueOnce(lot({ id: "lot-b", productionOrderId: "po-2" }) as never);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-b"] })).rejects.toMatchObject({ code: "LOT_GENEALOGY_INVALID" });
  });

  it("rejects merging lots with different units of measure", async () => {
    vi.mocked(LotRepository.findAnyById)
      .mockResolvedValueOnce(lot({ id: "lot-a", uomId: "uom-1" }) as never)
      .mockResolvedValueOnce(lot({ id: "lot-b", uomId: "uom-2" }) as never);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-b"] })).rejects.toMatchObject({ code: "LOT_GENEALOGY_INVALID" });
  });

  it("rejects merging a lot that has an open job order", async () => {
    vi.mocked(LotRepository.findAnyById)
      .mockResolvedValueOnce(lot({ id: "lot-a" }) as never)
      .mockResolvedValueOnce(lot({ id: "lot-b" }) as never);
    vi.mocked(LotRepository.countOpenJobOrders).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-b"] })).rejects.toMatchObject({ code: "LOT_GENEALOGY_INVALID" });
  });

  it("rejects when a referenced lot doesn't exist", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValueOnce(lot({ id: "lot-a" }) as never).mockResolvedValueOnce(null as never);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-missing"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

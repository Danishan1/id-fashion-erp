import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  previewNextMasterCode: vi.fn(),
  advanceMasterCodeSequence: vi.fn(),
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    fabricRoll: { findUnique: vi.fn() },
    lot: { findUnique: vi.fn() },
    carton: { findUnique: vi.fn() },
    product: { findFirst: vi.fn(), findUnique: vi.fn() },
    productVariant: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("./barcode.repository", () => ({
  BarcodeRepository: {
    createInTx: vi.fn(),
    findActiveByCode: vi.fn(),
    findActiveByEntity: vi.fn(),
    findAnyByCode: vi.fn(),
    reactivate: vi.fn(),
    findById: vi.fn(),
    findAllByEntity: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    disable: vi.fn(),
    deleteManyByEntityIds: vi.fn(),
  },
}));

const { BarcodeRepository } = await import("./barcode.repository");
const { previewNextMasterCode, advanceMasterCodeSequence } = await import("@/core/numbering/DocumentNumberingService");
const { prisma } = await import("@/core/db/client");
const {
  registerBarcode,
  mintFabricRollBarcode,
  registerProductionLotBarcode,
  replaceCartonBarcodes,
  generateItemOrSkuBarcode,
  resolveBarcode,
  disableBarcode,
} = await import("./barcode.service");

const actor = { companyId: "co-1", userId: "user-1" };

function p2002(field: string) {
  return { code: "P2002", meta: { target: [field] } };
}

beforeEach(() => {
  vi.mocked(BarcodeRepository.createInTx).mockReset();
  vi.mocked(BarcodeRepository.findActiveByCode).mockReset();
  vi.mocked(BarcodeRepository.findActiveByEntity).mockReset();
  vi.mocked(BarcodeRepository.findAnyByCode).mockReset();
  vi.mocked(BarcodeRepository.reactivate).mockReset();
  vi.mocked(BarcodeRepository.findById).mockReset();
  vi.mocked(BarcodeRepository.findMany).mockReset();
  vi.mocked(BarcodeRepository.count).mockReset();
  vi.mocked(BarcodeRepository.disable).mockReset();
  vi.mocked(BarcodeRepository.deleteManyByEntityIds).mockReset().mockResolvedValue({ count: 0 } as never);
  vi.mocked(previewNextMasterCode).mockReset();
  vi.mocked(advanceMasterCodeSequence).mockReset();
  vi.mocked(prisma.product.findFirst).mockReset();
  vi.mocked(prisma.productVariant.findFirst).mockReset();
  vi.mocked(prisma.productVariant.update).mockReset();
  vi.mocked(prisma.lot.findUnique).mockReset();
});

describe("registerBarcode", () => {
  it("creates the row as-is on the happy path", async () => {
    vi.mocked(BarcodeRepository.createInTx).mockResolvedValue({ id: "b-1", code: "FR-00001" } as never);
    const result = await registerBarcode(prisma as never, actor, { entityType: "FABRIC_ROLL", entityId: "roll-1", code: "FR-00001" });
    expect(result).toMatchObject({ id: "b-1", code: "FR-00001" });
  });

  it("returns the existing active barcode when the entity already has one (idempotent re-mint)", async () => {
    vi.mocked(BarcodeRepository.createInTx).mockRejectedValue(p2002("entity_id"));
    vi.mocked(BarcodeRepository.findActiveByEntity).mockResolvedValue({ id: "existing", code: "FR-00002" } as never);

    const result = await registerBarcode(prisma as never, actor, { entityType: "FABRIC_ROLL", entityId: "roll-1", code: "FR-00099" });
    expect(result).toMatchObject({ id: "existing" });
  });

  it("throws a clean VALIDATION_ERROR when the code itself collides with a DIFFERENT entity's barcode", async () => {
    vi.mocked(BarcodeRepository.createInTx).mockRejectedValue(p2002("code"));
    vi.mocked(BarcodeRepository.findAnyByCode).mockResolvedValue({
      id: "other",
      entityType: "FABRIC_ROLL",
      entityId: "some-other-roll",
    } as never);

    await expect(
      registerBarcode(prisma as never, actor, { entityType: "FABRIC_ROLL", entityId: "roll-1", code: "FR-00001" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(BarcodeRepository.reactivate).not.toHaveBeenCalled();
  });

  // Real bug caught during live verification (2026-09-29): a "reuse a
  // stable identifier" code (Product.styleCode/Lot.lotNumber) is fixed
  // forever for its own entity, so re-generating after a disable ALWAYS
  // collides with that same entity's own disabled row — this must
  // reactivate it, not report "already registered to a different item."
  it("reactivates the SAME entity's own disabled row instead of erroring, when the code collision is with itself", async () => {
    vi.mocked(BarcodeRepository.createInTx).mockRejectedValue(p2002("code"));
    vi.mocked(BarcodeRepository.findAnyByCode).mockResolvedValue({
      id: "b-old",
      code: "MAT-00012",
      entityType: "ITEM",
      entityId: "prod-1",
      status: "DISABLED",
    } as never);

    const result = await registerBarcode(prisma as never, actor, { entityType: "ITEM", entityId: "prod-1", code: "MAT-00012" });

    expect(BarcodeRepository.reactivate).toHaveBeenCalledWith("co-1", "b-old");
    expect(result).toMatchObject({ id: "b-old", status: "ACTIVE" });
  });
});

describe("mintFabricRollBarcode", () => {
  it("advances the counter only when its own drawn code was actually used", async () => {
    vi.mocked(previewNextMasterCode).mockResolvedValue("FR-00005");
    vi.mocked(BarcodeRepository.createInTx).mockResolvedValue({ id: "b-1", code: "FR-00005" } as never);

    await mintFabricRollBarcode(actor, "roll-1");

    expect(advanceMasterCodeSequence).toHaveBeenCalledWith("co-1", "FABRIC_ROLL");
  });

  it("does NOT advance the counter when registerBarcode returned a pre-existing row instead", async () => {
    vi.mocked(previewNextMasterCode).mockResolvedValue("FR-00005");
    vi.mocked(BarcodeRepository.createInTx).mockRejectedValue(p2002("entity_id"));
    vi.mocked(BarcodeRepository.findActiveByEntity).mockResolvedValue({ id: "existing", code: "FR-00001" } as never);

    await mintFabricRollBarcode(actor, "roll-1");

    expect(advanceMasterCodeSequence).not.toHaveBeenCalled();
  });
});

describe("registerProductionLotBarcode", () => {
  it("reuses lotNumber verbatim as the code, with no numbering call at all", async () => {
    vi.mocked(BarcodeRepository.createInTx).mockResolvedValue({ id: "b-1", code: "PROD-2026-00001-L01" } as never);

    await registerProductionLotBarcode(actor, "lot-1", "PROD-2026-00001-L01");

    expect(BarcodeRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "PROD-2026-00001-L01", entityType: "PRODUCTION_LOT", entityId: "lot-1" })
    );
    expect(previewNextMasterCode).not.toHaveBeenCalled();
  });
});

describe("replaceCartonBarcodes", () => {
  it("deletes the previous cartons' barcodes then registers a fresh one per new carton using the derived code", async () => {
    vi.mocked(BarcodeRepository.createInTx).mockResolvedValue({ id: "b-new" } as never);

    await replaceCartonBarcodes(actor, {
      previousCartonIds: ["old-1", "old-2"],
      dispatchNumber: "DSP-2026-00007",
      newCartons: [{ id: "new-1", cartonNumber: 1 }, { id: "new-2", cartonNumber: 2 }],
    });

    expect(BarcodeRepository.deleteManyByEntityIds).toHaveBeenCalledWith("co-1", "CARTON", ["old-1", "old-2"]);
    expect(BarcodeRepository.createInTx).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ code: "DSP-2026-00007-C1", entityType: "CARTON", entityId: "new-1" })
    );
    expect(BarcodeRepository.createInTx).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ code: "DSP-2026-00007-C2", entityType: "CARTON", entityId: "new-2" })
    );
  });
});

describe("generateItemOrSkuBarcode", () => {
  it("reuses Product.styleCode verbatim for an ITEM (raw material)", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: "prod-1", styleCode: "MAT-00001" } as never);
    vi.mocked(BarcodeRepository.createInTx).mockResolvedValue({ id: "b-1", code: "MAT-00001" } as never);

    const result = await generateItemOrSkuBarcode(actor, { entityType: "ITEM", entityId: "prod-1" });

    expect(result).toMatchObject({ code: "MAT-00001" });
    expect(previewNextMasterCode).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for an ITEM id that isn't a raw material in this company", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValue(null);
    await expect(generateItemOrSkuBarcode(actor, { entityType: "ITEM", entityId: "not-a-material" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("mints a new SKU code and back-fills ProductVariant.barcode when a fresh code was actually used", async () => {
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValue({ id: "var-1" } as never);
    vi.mocked(previewNextMasterCode).mockResolvedValue("SKU-00003");
    vi.mocked(BarcodeRepository.createInTx).mockResolvedValue({ id: "b-1", code: "SKU-00003" } as never);

    await generateItemOrSkuBarcode(actor, { entityType: "SKU", entityId: "var-1" });

    expect(advanceMasterCodeSequence).toHaveBeenCalledWith("co-1", "SKU");
    expect(prisma.productVariant.update).toHaveBeenCalledWith({ where: { id: "var-1" }, data: { barcode: "SKU-00003" } });
  });

  it("does not touch ProductVariant.barcode when registerBarcode returns a pre-existing row", async () => {
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValue({ id: "var-1" } as never);
    vi.mocked(previewNextMasterCode).mockResolvedValue("SKU-00003");
    vi.mocked(BarcodeRepository.createInTx).mockRejectedValue(p2002("entity_id"));
    vi.mocked(BarcodeRepository.findActiveByEntity).mockResolvedValue({ id: "existing", code: "SKU-00001" } as never);

    await generateItemOrSkuBarcode(actor, { entityType: "SKU", entityId: "var-1" });

    expect(advanceMasterCodeSequence).not.toHaveBeenCalled();
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
  });
});

describe("resolveBarcode", () => {
  it("throws NOT_FOUND for a code with no active barcode", async () => {
    vi.mocked(BarcodeRepository.findActiveByCode).mockResolvedValue(null);
    await expect(resolveBarcode(actor, "unknown-code")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolves a PRODUCTION_LOT barcode to its real entity summary", async () => {
    vi.mocked(BarcodeRepository.findActiveByCode).mockResolvedValue({
      code: "PROD-2026-00001-L01",
      entityType: "PRODUCTION_LOT",
      entityId: "lot-1",
    } as never);
    vi.mocked(prisma.lot.findUnique).mockResolvedValue({
      id: "lot-1",
      lotNumber: "PROD-2026-00001-L01",
      quantity: 100,
      status: "IN_PROGRESS",
      productionOrder: { id: "po-1", orderNumber: "PROD-2026-00001", product: { styleName: "Crew Neck Tee" } },
    } as never);

    const result = await resolveBarcode(actor, "PROD-2026-00001-L01");

    expect(result.summary).toMatchObject({ kind: "PRODUCTION_LOT", lotNumber: "PROD-2026-00001-L01", quantity: 100 });
  });

  it("throws NOT_FOUND when the barcode is active but its underlying entity is gone", async () => {
    vi.mocked(BarcodeRepository.findActiveByCode).mockResolvedValue({
      code: "PROD-2026-00001-L01",
      entityType: "PRODUCTION_LOT",
      entityId: "lot-deleted",
    } as never);
    vi.mocked(prisma.lot.findUnique).mockResolvedValue(null);

    await expect(resolveBarcode(actor, "PROD-2026-00001-L01")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("disableBarcode", () => {
  it("throws NOT_FOUND when the barcode doesn't exist for this company", async () => {
    vi.mocked(BarcodeRepository.findById).mockResolvedValue(null);
    await expect(disableBarcode(actor, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects disabling an already-disabled barcode", async () => {
    vi.mocked(BarcodeRepository.findById).mockResolvedValue({ id: "b-1", status: "DISABLED" } as never);
    await expect(disableBarcode(actor, "b-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(BarcodeRepository.disable).not.toHaveBeenCalled();
  });

  it("disables an active barcode and audit-logs the change", async () => {
    vi.mocked(BarcodeRepository.findById)
      .mockResolvedValueOnce({ id: "b-1", status: "ACTIVE" } as never)
      .mockResolvedValueOnce({ id: "b-1", status: "DISABLED" } as never);
    vi.mocked(BarcodeRepository.disable).mockResolvedValue({ count: 1 } as never);

    const result = await disableBarcode(actor, "b-1");

    expect(BarcodeRepository.disable).toHaveBeenCalledWith("co-1", "b-1");
    expect(result).toMatchObject({ status: "DISABLED" });
  });
});

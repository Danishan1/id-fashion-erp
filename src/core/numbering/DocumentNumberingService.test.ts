import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstMock, updateMock, createMock, transactionMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    documentSequence: {
      findFirst: findFirstMock,
      update: updateMock,
      create: createMock,
    },
    $transaction: transactionMock,
  },
}));

const { generateDocumentNumber, previewNextMasterCode, advanceMasterCodeSequence } = await import(
  "./DocumentNumberingService"
);

beforeEach(() => {
  findFirstMock.mockReset();
  updateMock.mockReset();
  createMock.mockReset();
  transactionMock.mockReset();
  // Every call site passes an async (tx) => {...} callback — run it against
  // the same mocked delegates so tests can assert on find/update/create directly.
  transactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({ documentSequence: { findFirst: findFirstMock, update: updateMock, create: createMock } })
  );
});

describe("generateDocumentNumber", () => {
  it("creates a new sequence starting at 1 when none exists yet", async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ prefix: "SAM", currentNumber: 1, paddingLength: 5 });

    const result = await generateDocumentNumber({ companyId: "co-1", documentType: "SAMPLE_REQUEST", fiscalYear: 2026 });

    expect(result).toBe("SAM-2026-00001");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "co-1", currentNumber: 1 }) })
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("atomically increments an existing sequence rather than SELECT MAX()+1", async () => {
    findFirstMock.mockResolvedValue({ id: "seq-1", prefix: "ORD", currentNumber: 41, paddingLength: 5 });
    updateMock.mockResolvedValue({ prefix: "ORD", currentNumber: 42, paddingLength: 5 });

    const result = await generateDocumentNumber({ companyId: "co-1", documentType: "SALES_ORDER", fiscalYear: 2026 });

    expect(result).toBe("ORD-2026-00042");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "seq-1" },
      data: { currentNumber: { increment: 1 } },
    });
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("master code numbering (never resets by fiscal year)", () => {
  it("previewNextMasterCode returns 1 formatted when no sequence row exists", async () => {
    findFirstMock.mockResolvedValue(null);
    const code = await previewNextMasterCode("co-1", "CUSTOMER");
    expect(code).toBe("CUST-00001");
  });

  it("previewNextMasterCode previews currentNumber + 1 without writing anything", async () => {
    findFirstMock.mockResolvedValue({ currentNumber: 5 });
    const code = await previewNextMasterCode("co-1", "CUSTOMER");
    expect(code).toBe("CUST-00006");
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("advanceMasterCodeSequence increments an existing row under the fixed sentinel year", async () => {
    findFirstMock.mockResolvedValue({ id: "seq-9", currentNumber: 5 });

    await advanceMasterCodeSequence("co-1", "CUSTOMER");

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { companyId: "co-1", branchId: null, documentType: "CUSTOMER", fiscalYear: 0 },
    });
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "seq-9" }, data: { currentNumber: { increment: 1 } } });
  });

  it("advanceMasterCodeSequence creates the row on first use", async () => {
    findFirstMock.mockResolvedValue(null);

    await advanceMasterCodeSequence("co-1", "STYLE");

    expect(createMock).toHaveBeenCalledWith({
      data: { companyId: "co-1", branchId: null, documentType: "STYLE", prefix: "ST", fiscalYear: 0, currentNumber: 1 },
    });
  });

  // Barcode Management & Scanning System, Phase 1 (2026-09-29) — the two new
  // master-code document types, same mechanism, new prefixes.
  it("previewNextMasterCode formats FABRIC_ROLL with the FR prefix", async () => {
    findFirstMock.mockResolvedValue({ currentNumber: 4 });
    expect(await previewNextMasterCode("co-1", "FABRIC_ROLL")).toBe("FR-00005");
  });

  it("previewNextMasterCode formats SKU with the SKU prefix", async () => {
    findFirstMock.mockResolvedValue(null);
    expect(await previewNextMasterCode("co-1", "SKU")).toBe("SKU-00001");
  });
});

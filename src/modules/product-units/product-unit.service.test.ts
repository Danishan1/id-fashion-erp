import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mintProductUnitsInTx,
  resolveProductUnitTraceability,
  packUnitIntoCarton,
} from "./product-unit.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/barcode/barcode.service", () => ({ registerBarcode: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  generateMasterCodeInTx: vi.fn().mockImplementation((_tx, _comp, _docType) => {
    return Promise.resolve("FG-00000001");
  }),
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    productUnit: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    carton: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    cartonItem: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    productUnitEvent: {
      create: vi.fn(),
    },
    barcode: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const { prisma } = await import("@/core/db/client");
const { registerBarcode } = await import("@/core/barcode/barcode.service");

const actor = { companyId: "comp-1", userId: "user-1" };

describe("product-unit.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("mintProductUnitsInTx", () => {
    it("mints serialized product units with FG codes and registers barcodes", async () => {
      const mockCreate = vi.fn().mockImplementation(({ data }) => ({
        id: "unit-1",
        ...data,
      }));

      const mockTx = {
        productUnit: { create: mockCreate },
        barcode: { create: vi.fn() },
      } as never;

      const units = await mintProductUnitsInTx(mockTx, actor, {
        productId: "prod-1",
        productVariantId: "var-1",
        productionOrderId: "po-1",
        lotId: "lot-1",
        quantity: 2,
      });

      expect(units).toHaveLength(2);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(registerBarcode).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: "comp-1",
            unitCode: "FG-00000001",
            productId: "prod-1",
            productVariantId: "var-1",
            status: "PACKED",
          }),
        })
      );
    });

    it("safely returns empty array if tx.productUnit is undefined", async () => {
      const mockTx = {} as never;
      const units = await mintProductUnitsInTx(mockTx, actor, {
        productId: "prod-1",
        productVariantId: "var-1",
        productionOrderId: "po-1",
        lotId: "lot-1",
        quantity: 1,
      });
      expect(units).toEqual([]);
    });
  });

  describe("resolveProductUnitTraceability", () => {
    it("returns full provenance history for an existing unit", async () => {
      const mockUnit = {
        id: "unit-1",
        unitCode: "FG-00000001",
        status: "DISPATCHED",
        product: { styleCode: "ST-001", styleName: "Classic Oxford" },
        productVariant: { skuCode: "SKU-001", color: { name: "Blue" }, size: { name: "M" } },
        productionOrder: { orderNumber: "PO-2026-0001" },
        lot: { lotNumber: "LOT-001" },
        salesOrder: { orderNumber: "SO-2026-0001", customer: { name: "Acme Retail" } },
        carton: null,
        dispatch: { dispatchNumber: "DSP-2026-0001", dispatchedAt: new Date() },
        events: [],
      };

      vi.mocked(prisma.productUnit.findFirst).mockResolvedValue(mockUnit as never);

      const result = await resolveProductUnitTraceability(actor, "FG-00000001");
      expect(result).toEqual(mockUnit);
      expect(prisma.productUnit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: "comp-1",
            OR: [{ unitCode: "FG-00000001" }, { id: "FG-00000001" }],
          }),
        })
      );
    });

    it("throws NOT_FOUND if unit does not exist", async () => {
      vi.mocked(prisma.productUnit.findFirst).mockResolvedValue(null);

      await expect(resolveProductUnitTraceability(actor, "UNKNOWN")).rejects.toThrow(
        BusinessRuleError
      );
    });
  });

  describe("packUnitIntoCarton", () => {
    it("packs an eligible unit into a carton and creates PACKED_INTO_CARTON event", async () => {
      const mockCarton = {
        id: "cart-1",
        cartonNumber: 1,
        dispatchId: "disp-1",
        dispatch: {
          id: "disp-1",
          companyId: "comp-1",
          status: "DRAFT",
          items: [{ id: "di-1", productId: "prod-1" }],
        },
      };

      const mockUnit = {
        id: "unit-1",
        unitCode: "FG-00000001",
        status: "PACKED",
        productId: "prod-1",
        productVariantId: "var-1",
        cartonId: null,
        product: { styleName: "Classic Tee" },
        productVariant: { color: { name: "Blue" }, size: { name: "M" } },
      };

      vi.mocked(prisma.carton.findUnique).mockResolvedValue(mockCarton as never);
      vi.mocked(prisma.productUnit.findUnique).mockResolvedValue(mockUnit as never);
      vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) => {
        const tx = {
          cartonItem: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "ci-1" }),
          },
          carton: { update: vi.fn() },
          productUnit: {
            update: vi.fn().mockResolvedValue({
              id: "unit-1",
              unitCode: "FG-00000001",
              status: "PACKED",
              cartonId: "cart-1",
            }),
          },
          productUnitEvent: { create: vi.fn() },
        };
        return cb(tx);
      }) as never);

      const res = await packUnitIntoCarton(actor, "cart-1", "FG-00000001");

      expect(res.id).toBe("unit-1");
      expect(res.unitCode).toBe("FG-00000001");
    });

    it("rejects packing if unit is already dispatched", async () => {
      const mockCarton = {
        id: "cart-1",
        cartonNumber: 1,
        dispatchId: "disp-1",
        dispatch: {
          id: "disp-1",
          companyId: "comp-1",
          status: "DRAFT",
          items: [{ id: "di-1", productId: "prod-1" }],
        },
      };

      const mockUnit = {
        id: "unit-1",
        unitCode: "FG-00000001",
        status: "DISPATCHED",
        product: { styleName: "Classic Tee" },
      };

      vi.mocked(prisma.carton.findUnique).mockResolvedValue(mockCarton as never);
      vi.mocked(prisma.productUnit.findUnique).mockResolvedValue(mockUnit as never);

      await expect(
        packUnitIntoCarton(actor, "cart-1", "FG-00000001")
      ).rejects.toThrow(BusinessRuleError);
    });
  });
});

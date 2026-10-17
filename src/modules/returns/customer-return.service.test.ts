import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCustomerReturn,
  listCustomerReturns,
} from "./customer-return.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  generateMasterCodeInTx: vi.fn().mockResolvedValue("RET-00000001"),
}));
vi.mock("@/modules/inventory/inventory.service", () => ({
  recordInventoryTransaction: vi.fn().mockResolvedValue({ id: "tx-1" }),
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    productUnit: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    customerReturn: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    customerReturnItem: {
      create: vi.fn(),
    },
    productUnitEvent: {
      create: vi.fn(),
    },
  },
}));

const { prisma } = await import("@/core/db/client");
const { recordInventoryTransaction } = await import("@/modules/inventory/inventory.service");

const actor = { companyId: "comp-1", userId: "user-1" };

describe("customer-return.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCustomerReturn", () => {
    it("successfully creates return, restocks inventory, and updates unit status", async () => {
      const mockUnits = [
        {
          id: "unit-1",
          unitCode: "FG-00000001",
          status: "DISPATCHED",
          productId: "prod-1",
          productVariantId: "var-1",
          currentWarehouseId: "wh-1",
          product: { id: "prod-1" },
          productVariant: { id: "var-1" },
        },
      ];

      vi.mocked(prisma.productUnit.findMany).mockResolvedValue(mockUnits as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
        const tx = {
          customerReturn: {
            create: vi.fn().mockResolvedValue({
              id: "ret-1",
              returnNumber: "RET-00000001",
            }),
          },
          customerReturnItem: {
            create: vi.fn().mockResolvedValue({ id: "item-1" }),
          },
          productUnit: {
            update: vi.fn().mockResolvedValue({ id: "unit-1", status: "IN_STOCK" }),
          },
          productUnitEvent: {
            create: vi.fn().mockResolvedValue({ id: "ev-1" }),
          },
        };
        return cb(tx);
      });

      const result = await createCustomerReturn(actor, {
        customerId: "cust-1",
        salesOrderId: "so-1",
        remarks: "Customer returned unworn piece",
        items: [
          {
            productUnitCode: "FG-00000001",
            returnReason: "Wrong size",
            condition: "GOOD",
            disposition: "RESTOCK",
            restockWarehouseId: "wh-fg",
          },
        ],
      });

      expect(result.id).toBe("ret-1");
      expect(result.returnNumber).toBe("RET-00000001");
      expect(recordInventoryTransaction).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        expect.objectContaining({
          transactionType: "STOCK_IN",
          productId: "prod-1",
          productVariantId: "var-1",
          warehouseId: "wh-fg",
          quantity: 1,
        })
      );
    });

    it("rejects return if garment is not in DISPATCHED status", async () => {
      const mockUnits = [
        {
          id: "unit-1",
          unitCode: "FG-00000001",
          status: "PACKED",
        },
      ];

      vi.mocked(prisma.productUnit.findMany).mockResolvedValue(mockUnits as any);

      await expect(
        createCustomerReturn(actor, {
          customerId: "cust-1",
          items: [
            {
              productUnitCode: "FG-00000001",
              returnReason: "Size issue",
              condition: "GOOD",
              disposition: "RESTOCK",
              restockWarehouseId: "wh-1",
            },
          ],
        })
      ).rejects.toThrow(BusinessRuleError);
    });

    it("rejects restock if warehouse is missing", async () => {
      const mockUnits = [
        {
          id: "unit-1",
          unitCode: "FG-00000001",
          status: "DISPATCHED",
        },
      ];

      vi.mocked(prisma.productUnit.findMany).mockResolvedValue(mockUnits as any);

      await expect(
        createCustomerReturn(actor, {
          customerId: "cust-1",
          items: [
            {
              productUnitCode: "FG-00000001",
              returnReason: "Size issue",
              condition: "GOOD",
              disposition: "RESTOCK",
              restockWarehouseId: null,
            },
          ],
        })
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe("listCustomerReturns", () => {
    it("returns list of customer returns with relations", async () => {
      const mockReturns = [
        {
          id: "ret-1",
          returnNumber: "RET-00000001",
          customer: { name: "Retail Co" },
          items: [],
        },
      ];

      vi.mocked(prisma.customerReturn.findMany).mockResolvedValue(mockReturns as any);

      const res = await listCustomerReturns(actor);
      expect(res).toEqual(mockReturns);
      expect(prisma.customerReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: "comp-1" },
        })
      );
    });
  });
});

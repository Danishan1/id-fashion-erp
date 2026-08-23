import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const PurchaseOrderRepository = {
  findMany: (where: Prisma.PurchaseOrderWhereInput, args: Omit<Prisma.PurchaseOrderFindManyArgs, "where">) =>
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.PurchaseOrderWhereInput) => prisma.purchaseOrder.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: {
        supplier: true,
        requestedBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                styleName: true,
                styleCode: true,
                materialCategory: true,
                baseUomId: true,
                baseUom: { select: { id: true, name: true, baseUnitId: true, conversionFactor: true } },
              },
            },
            uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
            materialRequestItem: {
              select: { id: true, materialRequest: { select: { id: true, requestNumber: true } } },
            },
          },
        },
        receipts: {
          include: { receivedBy: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.purchaseOrder.findFirst({ where: { id, companyId } }),

  /** Same scope as findAnyById, plus each item's unitPrice — used by
   * approvePurchaseOrder()'s zero-price backstop (see BUG-04) without paying
   * for findByIdWithDetails's much heavier supplier/receipts/product include. */
  findAnyByIdWithItemPrices: (companyId: string, id: string) =>
    prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: { items: { select: { id: true, unitPrice: true } } },
    }),

  createWithItems: (data: Prisma.PurchaseOrderUncheckedCreateInput) =>
    prisma.purchaseOrder.create({ data, include: { items: true } }),

  update: (id: string, data: Prisma.PurchaseOrderUncheckedUpdateInput) =>
    prisma.purchaseOrder.update({ where: { id }, data }),

  /**
   * Full replace of a PO's items — same reasoning as Sales Orders'
   * replaceItems(): simplest correct way to apply an edit without hand-diffing
   * which lines changed, for a header+detail structure with no independent
   * per-line lifecycle. Runs inside one transaction so a mid-way failure
   * never leaves the order with a partial item list.
   */
  replaceItems: (
    purchaseOrderId: string,
    headerData: Prisma.PurchaseOrderUncheckedUpdateInput,
    items: Array<{
      productId: string;
      uomId: string;
      orderedQuantity: number;
      unitPrice: number;
      notes: string | null;
    }>
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId } });

      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          ...headerData,
          items: { create: items },
        },
      });

      return tx.purchaseOrder.findFirstOrThrow({
        where: { id: purchaseOrderId },
        include: { items: true },
      });
    }),

  /** Non-cancelled receipts against this PO — used by cancelPurchaseOrder()
   * to block cancellation once any goods have actually arrived, regardless
   * of the PO's current status label (including ON_HOLD). */
  countActiveReceipts: (purchaseOrderId: string) =>
    prisma.goodsReceipt.count({ where: { purchaseOrderId, status: { not: "CANCELLED" } } }),

  updateStatusInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.PurchaseOrderUncheckedUpdateInput) =>
    tx.purchaseOrder.update({ where: { id }, data }),
};

/** Colocated here rather than a dedicated Company module — a single scalar
 * lookup needed only for this feature's currency-defaulting logic, same
 * pattern already used in sales-order.repository.ts. */
export const CompanyRepository = {
  findBaseCurrencyCode: (companyId: string) =>
    prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),
};

/**
 * PurchaseOrderItem's own accumulator mutations — colocated here since they
 * operate on a table this module owns. The guarded increment is the
 * over-receipt guard itself: expressing the cap directly in the `where`
 * clause (not a separate read-then-write) makes the check-and-write atomic
 * under concurrent receipts against the same line, which a plain read then
 * `increment` would not be.
 */
export const PurchaseOrderItemRepository = {
  guardedIncrementReceived: (tx: Prisma.TransactionClient, itemId: string, orderedQuantity: number, incrementBy: number) =>
    tx.purchaseOrderItem.updateMany({
      where: { id: itemId, receivedQuantity: { lte: orderedQuantity - incrementBy } },
      data: { receivedQuantity: { increment: incrementBy } },
    }),

  decrementReceived: (tx: Prisma.TransactionClient, itemId: string, decrementBy: number) =>
    tx.purchaseOrderItem.update({ where: { id: itemId }, data: { receivedQuantity: { decrement: decrementBy } } }),

  findManyForStatusRecompute: (tx: Prisma.TransactionClient, purchaseOrderId: string) =>
    tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      select: { orderedQuantity: true, receivedQuantity: true },
    }),
};

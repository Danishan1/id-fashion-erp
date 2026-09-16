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

  /** Top N order-number matches for this company — backs the Topbar Global
   * Search's Purchase Orders group. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.purchaseOrder.findMany({
      where: { companyId, orderNumber: { contains: term, mode: "insensitive" as const } },
      select: { id: true, orderNumber: true, supplier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: {
        // A narrow `select`, not `supplier: true` — the full model included
        // bankDetailsJson/taxRegistrationNo, exposed to anyone with mere
        // purchasing:view (no separate supplier-master permission implied).
        supplier: { select: { id: true, name: true, code: true, contactPerson: true, email: true, phone: true, paymentTermsDays: true } },
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
            color: { select: { id: true, name: true, hexValue: true } },
            dye: { select: { id: true, name: true, pantone: true } },
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
      colorId: string | null;
      dyeId: string | null;
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

  /** Items with any invoiced quantity — used alongside countActiveReceipts
   * to block cancellation once a Purchase Invoice with a live Journal entry
   * exists against this PO (Phase 7C), same "never inferred from the status
   * label alone" discipline, checked unconditionally including from ON_HOLD. */
  countInvoicedItems: (purchaseOrderId: string) =>
    prisma.purchaseOrderItem.count({ where: { purchaseOrderId, invoicedQuantity: { gt: 0 } } }),

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
 * operate on a table this module owns. incrementReceived is deliberately
 * uncapped against orderedQuantity — a supplier routinely ships more (or
 * less) than what was ordered, and the warehouse must be able to record
 * exactly what physically arrived rather than being blocked at the ordered
 * figure (see goods-receipt.service.ts's own short/extra-quantity handling).
 * Still a plain atomic row update (Postgres's own `SET x = x + delta` has no
 * lost-update race), just with no upper-bound condition left to express.
 */
export const PurchaseOrderItemRepository = {
  incrementReceived: (tx: Prisma.TransactionClient, itemId: string, incrementBy: number) =>
    tx.purchaseOrderItem.updateMany({
      where: { id: itemId },
      data: { receivedQuantity: { increment: incrementBy } },
    }),

  /**
   * Guards receivedQuantity's decrement against the LIVE invoicedQuantity
   * column (Phase 7C) — receivedQuantity can never drop below what's already
   * been invoiced. This can't use the usual guarded-updateMany idiom above
   * (comparing a column to a JS-literal cap read once outside the
   * transaction): the cap here (invoicedQuantity) is itself mutable, and
   * Prisma's `updateMany` `where` clause has no way to express a
   * column-to-column comparison. A single-statement raw SQL conditional
   * update is the only way to compare both columns atomically at execution
   * time — the first use of raw SQL anywhere in this codebase, used
   * deliberately and narrowly for exactly this reason, not as a habit.
   * Returns the affected-row count; 0 means the guard failed.
   */
  guardedDecrementReceived: (tx: Prisma.TransactionClient, itemId: string, decrementBy: number): Promise<number> =>
    tx.$executeRaw`
      UPDATE purchase_order_items
      SET received_quantity = received_quantity - ${decrementBy}
      WHERE id = ${itemId}::uuid AND received_quantity - ${decrementBy} >= invoiced_quantity
    `,

  /**
   * Guards invoicedQuantity's increment against the LIVE receivedQuantity
   * column (Phase 7C's own over-invoice guard) — same raw-SQL reasoning as
   * guardedDecrementReceived above, mirrored for the opposite direction.
   * Called only at Purchase Invoice POST time, never at DRAFT creation.
   */
  guardedIncrementInvoiced: (tx: Prisma.TransactionClient, itemId: string, incrementBy: number): Promise<number> =>
    tx.$executeRaw`
      UPDATE purchase_order_items
      SET invoiced_quantity = invoiced_quantity + ${incrementBy}
      WHERE id = ${itemId}::uuid AND invoiced_quantity + ${incrementBy} <= received_quantity
    `,

  findManyForStatusRecompute: (tx: Prisma.TransactionClient, purchaseOrderId: string) =>
    tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      select: { orderedQuantity: true, receivedQuantity: true },
    }),
};

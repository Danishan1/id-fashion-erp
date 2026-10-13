import { prisma } from "@/core/db/client";
import type { DispatchStatus, Prisma } from "@prisma/client";

const detailInclude = {
  salesOrder: { select: { id: true, orderNumber: true, status: true } },
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, fullName: true } },
  forwarder: { select: { id: true, code: true, name: true, type: true, phone: true, contactPerson: true } },
  items: {
    include: {
      product: { select: { id: true, styleName: true, styleCode: true } },
      salesOrderItem: { select: { id: true, dispatchedQuantity: true, regularDispatchedQuantity: true } },
    },
  },
  cartons: {
    orderBy: { cartonNumber: "asc" as const },
    include: {
      items: {
        include: {
          dispatchItem: { select: { id: true, productId: true } },
          productVariant: { include: { color: true, size: true } },
        },
      },
    },
  },
} satisfies Prisma.DispatchInclude;

// Extra Dispatch Quantity (2026-09-30) — the shape buildDispatchItems() in
// dispatch.service.ts always produces, for both a fresh create and a full
// item replace.
type DispatchItemCreateShape = {
  salesOrderItemId: string;
  productId: string;
  dispatchedQuantity: number;
  regularDispatchQuantity: number;
  extraDispatchQuantity: number;
  extraDispatchReason: Prisma.DispatchItemUncheckedCreateInput["extraDispatchReason"];
  extraDispatchRemarks: string | null;
};

export const DispatchRepository = {
  findMany: (where: Prisma.DispatchWhereInput, args: Omit<Prisma.DispatchFindManyArgs, "where">) =>
    prisma.dispatch.findMany({
      where,
      include: {
        salesOrder: { select: { id: true, orderNumber: true } },
        customer: { select: { id: true, name: true } },
        forwarder: { select: { name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.DispatchWhereInput) => prisma.dispatch.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.dispatch.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.dispatch.findFirst({ where: { id, companyId }, include: detailInclude }),

  /** Any Dispatch (any status, including CANCELLED — a cancelled Dispatch's
   * own DispatchItem rows still sit on the salesOrderItemId FK) referencing
   * this order — used by updateSalesOrder()'s edit guard. Deliberately NOT
   * scoped to non-cancelled rows the way Sales Invoice's own
   * findActiveByOrderId is, since replaceItems() would still hit the same
   * hard FK violation against a cancelled Dispatch's items. */
  findAnyByOrderId: (companyId: string, salesOrderId: string) =>
    prisma.dispatch.findFirst({ where: { companyId, salesOrderId } }),

  createWithItems: (
    data: Omit<Prisma.DispatchUncheckedCreateInput, "items">,
    items: DispatchItemCreateShape[]
  ) =>
    prisma.dispatch.create({
      data: { ...data, items: { create: items } },
      include: detailInclude,
    }),

  /** Full replace of a Dispatch's items — also clears any existing Cartons/
   * CartonItems, since CartonItem.dispatchItemId would otherwise point at a
   * deleted row. Reopens the Dispatch to DRAFT if it was PACKED, since
   * whatever was packed no longer corresponds to the new item set. */
  replaceItems: (
    dispatchId: string,
    headerData: Prisma.DispatchUncheckedUpdateInput,
    items: DispatchItemCreateShape[]
  ) =>
    prisma.$transaction(async (tx) => {
      const cartonIds = (await tx.carton.findMany({ where: { dispatchId }, select: { id: true } })).map((c) => c.id);
      await tx.cartonItem.deleteMany({ where: { cartonId: { in: cartonIds } } });
      await tx.carton.deleteMany({ where: { dispatchId } });
      await tx.dispatchItem.deleteMany({ where: { dispatchId } });

      await tx.dispatch.update({
        where: { id: dispatchId },
        data: { ...headerData, status: "DRAFT", items: { create: items } },
      });

      return tx.dispatch.findFirstOrThrow({ where: { id: dispatchId }, include: detailInclude });
    }),

  /** Full replace of a Dispatch's cartons — simplest correct way to apply an
   * edit without hand-diffing which cartons changed (same pattern as Sales/
   * Purchase Order's own replaceItems()). Carton numbers are assigned 1..N
   * in array order by the caller, never client-supplied. */
  setCartons: (dispatchId: string, cartons: Array<{ cartonNumber: number; totalQuantity: number; items: Array<{ dispatchItemId: string; productVariantId: string | null; quantity: number }> }>) =>
    prisma.$transaction(async (tx) => {
      const existingCartonIds = (await tx.carton.findMany({ where: { dispatchId }, select: { id: true } })).map((c) => c.id);
      await tx.cartonItem.deleteMany({ where: { cartonId: { in: existingCartonIds } } });
      await tx.carton.deleteMany({ where: { dispatchId } });

      for (const carton of cartons) {
        await tx.carton.create({
          data: {
            dispatchId,
            cartonNumber: carton.cartonNumber,
            totalQuantity: carton.totalQuantity,
            items: { create: carton.items },
          },
        });
      }

      return tx.dispatch.findFirstOrThrow({ where: { id: dispatchId }, include: detailInclude });
    }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: DispatchStatus, data: Prisma.DispatchUncheckedUpdateInput) =>
    prisma.dispatch.updateMany({ where: { id, status: expectedStatus }, data }),

  updateStatusInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.DispatchUncheckedUpdateInput) =>
    tx.dispatch.update({ where: { id }, data }),
};

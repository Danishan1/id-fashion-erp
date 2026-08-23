import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const SalesOrderRepository = {
  findMany: (where: Prisma.SalesOrderWhereInput, args: Omit<Prisma.SalesOrderFindManyArgs, "where">) =>
    prisma.salesOrder.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        buyer: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.SalesOrderWhereInput) => prisma.salesOrder.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: {
        customer: true,
        buyer: true,
        requestedBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { id: true, styleName: true, styleCode: true, designNumber: true } },
            // Includes the sample's own customer — a linked sample can now
            // belong to a different customer than this order (see the
            // "search all customers" option on the create form), so the
            // detail page needs to be able to surface that explicitly rather
            // than implying it's always the order's own customer's sample.
            sampleRequest: {
              select: { id: true, requestNumber: true, status: true, customer: { select: { name: true } } },
            },
            breakdown: { include: { productVariant: { include: { color: true, size: true } } } },
          },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.salesOrder.findFirst({ where: { id, companyId } }),

  createWithItems: (data: Prisma.SalesOrderUncheckedCreateInput) =>
    prisma.salesOrder.create({
      data,
      include: { items: { include: { breakdown: true } } },
    }),

  update: (id: string, data: Prisma.SalesOrderUncheckedUpdateInput) =>
    prisma.salesOrder.update({ where: { id }, data }),

  /**
   * Full replace of a sales order's items/breakdown — simplest correct way to
   * apply an edit without hand-diffing which lines changed. Breakdown rows
   * have no cascade-delete configured, so they must be deleted before their
   * parent items; the whole thing runs in one transaction so a mid-way
   * failure never leaves the order with a partial item list.
   */
  replaceItems: (
    salesOrderId: string,
    headerData: Prisma.SalesOrderUncheckedUpdateInput,
    items: Array<{
      productId: string;
      sampleRequestId: string | null;
      unitPrice: number;
      notes: string | null;
      breakdown: Array<{ productVariantId: string; orderedQuantity: number }>;
    }>
  ) =>
    prisma.$transaction(async (tx) => {
      const existingItemIds = (await tx.salesOrderItem.findMany({ where: { salesOrderId }, select: { id: true } })).map(
        (i) => i.id
      );
      await tx.salesOrderItemBreakdown.deleteMany({ where: { salesOrderItemId: { in: existingItemIds } } });
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId } });

      await tx.salesOrder.update({
        where: { id: salesOrderId },
        data: {
          ...headerData,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              sampleRequestId: item.sampleRequestId,
              unitPrice: item.unitPrice,
              notes: item.notes,
              breakdown: { create: item.breakdown },
            })),
          },
        },
      });

      return tx.salesOrder.findFirstOrThrow({
        where: { id: salesOrderId },
        include: { items: { include: { breakdown: true } } },
      });
    }),
};

/** Colocated here rather than a dedicated Company module — a single scalar
 * lookup needed only for this feature's currency-defaulting logic. */
export const CompanyRepository = {
  findBaseCurrencyCode: (companyId: string) =>
    prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),
};

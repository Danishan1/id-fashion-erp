import { prisma } from "@/core/db/client";
import type { Prisma, SalesOrderStatus } from "@prisma/client";
import type { ReconciledSalesOrderItem } from "./sales-order-bom.service";

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

  /** Top N order-number matches for this company — backs the Topbar Global
   * Search's Sales Orders group. A narrow, capped, `select`-only query
   * (never the full `findMany`'s heavier `include`), matching the existing
   * `orderNumber`-contains predicate every list endpoint already uses. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.salesOrder.findMany({
      where: { companyId, orderNumber: { contains: term, mode: "insensitive" as const } },
      select: { id: true, orderNumber: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.salesOrder.findFirst({
      where: { id, companyId },
      include: {
        // A narrow `select`, not `customer: true` — the full model included
        // creditLimit/paymentTermsDays, exposed to anyone with mere
        // sales_orders:view (no separate customer-master permission implied).
        // billingAddress/shippingAddress/contactPerson/phone/email added
        // (2026-10-10, Dispatch address auto-fill) — Dispatch's own create
        // form reads these to default its per-dispatch address snapshot;
        // still excludes creditLimit/paymentTermsDays-adjacent financial
        // fields this grant was never meant to expose.
        customer: {
          select: {
            id: true,
            name: true,
            code: true,
            country: true,
            defaultCurrencyCode: true,
            paymentTermsDays: true,
            billingAddress: true,
            shippingAddress: true,
            contactPerson: true,
            phone: true,
            email: true,
          },
        },
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
              select: { id: true, requestNumber: true, styleName: true, status: true, customer: { select: { name: true } } },
            },
            breakdown: { include: { productVariant: { include: { color: true, size: true } } } },
          },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.salesOrder.findFirst({ where: { id, companyId } }),

  /** Most recent (by order date) non-cancelled item this exact customer has
   * ever ordered for this exact style — powers the "Last Order Price"
   * suggestion on the create/edit form, the same "suggest, never enforce"
   * convention already used for a linked sample's own costing default.
   * `excludeOrderId` keeps an in-progress edit from suggesting its own
   * not-yet-saved price back to itself. */
  findLastOrderedItem: (companyId: string, customerId: string, productId: string, excludeOrderId?: string) =>
    prisma.salesOrderItem.findFirst({
      where: {
        productId,
        salesOrder: {
          companyId,
          customerId,
          status: { not: "CANCELLED" },
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        },
      },
      orderBy: { salesOrder: { orderDate: "desc" } },
      select: { unitPrice: true, salesOrder: { select: { orderNumber: true, orderDate: true } } },
    }),

  /** The fuller history behind findLastOrderedItem's own single most-recent
   * pick — every real price this exact customer was actually charged for
   * this exact style, most-recent first — powers the Unit Price field's own
   * price-history suggestions (the same "real price history as datalist
   * suggestions" pattern already built for Purchase Order's own Unit Price
   * fields). `sinceDate` scopes it to a recency window (the create form asks
   * for the last year); omitted returns the full history. */
  findOrderedPriceHistory: (
    companyId: string,
    customerId: string,
    productId: string,
    excludeOrderId?: string,
    sinceDate?: Date
  ) =>
    prisma.salesOrderItem.findMany({
      where: {
        productId,
        salesOrder: {
          companyId,
          customerId,
          status: { not: "CANCELLED" },
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
          ...(sinceDate ? { orderDate: { gte: sinceDate } } : {}),
        },
      },
      orderBy: { salesOrder: { orderDate: "desc" } },
      select: { unitPrice: true, salesOrder: { select: { orderNumber: true, orderDate: true } } },
    }),

  /**
   * Effective BOM (2026-09-24) — creates the bare header only, no items.
   * createSalesOrder() follows up with replaceItems() (below) to populate
   * items via the exact same reconciled-write path updateSalesOrder() uses,
   * rather than a second, parallel nested-create shape that would have to be
   * kept in sync with it by hand.
   */
  createHeader: (data: Prisma.SalesOrderUncheckedCreateInput) => prisma.salesOrder.create({ data }),

  update: (id: string, data: Prisma.SalesOrderUncheckedUpdateInput) =>
    prisma.salesOrder.update({ where: { id }, data }),

  /**
   * Conditional status write — `WHERE id = ? AND status = expectedStatus`,
   * enforced at the database level via `updateMany` rather than a plain
   * `SELECT`-then-`update` by primary key. Closes the check-then-write race
   * where two concurrent callers both pass an in-app "current status" check
   * before either commits (e.g. two "Confirm" double-clicks), which would
   * otherwise both succeed and both fire side effects/audit rows for one
   * real event. Returns the number of rows updated — 0 means someone else
   * already moved this order out of `expectedStatus`, and the caller should
   * treat that as an invalid transition rather than retrying blindly.
   */
  updateStatusConditional: (id: string, expectedStatus: SalesOrderStatus, data: Prisma.SalesOrderUncheckedUpdateInput) =>
    prisma.salesOrder.updateMany({ where: { id, status: expectedStatus }, data }),

  /**
   * Same race-closing shape as `updateStatusConditional`, but against a SET
   * of acceptable prior statuses rather than one exact value — needed by
   * Sales Invoice posting, which accepts CONFIRMED or IN_PRODUCTION as the
   * order's status right before flipping it to INVOICED.
   */
  updateStatusConditionalIn: (id: string, expectedStatuses: SalesOrderStatus[], data: Prisma.SalesOrderUncheckedUpdateInput) =>
    prisma.salesOrder.updateMany({ where: { id, status: { in: expectedStatuses } }, data }),

  /**
   * Full replace of a sales order's items/breakdown — simplest correct way to
   * apply an edit without hand-diffing which lines changed. Breakdown rows
   * have no cascade-delete configured, so they must be deleted before their
   * parent items; the whole thing runs in one transaction so a mid-way
   * failure never leaves the order with a partial item list.
   *
   * Effective BOM (2026-09-24) — each item's own `lineLink` (decided by
   * sales-order-bom.service.ts's buildReconciledItemPlan(), never by this
   * repository) says whether to point the new SalesOrderItem at an EXISTING
   * SalesOrderLine (preserving its own frozen snapshot + any active
   * SalesOrderBomOverride rows completely untouched) or to create a fresh
   * one. Deliberately one item at a time (not a single bulk nested create,
   * unlike the pre-2026-09-24 shape) — each item may need its own new
   * SalesOrderLine row created first, whose id the item then references;
   * this app's order sizes (a handful of style lines) make the sequential-
   * awaits-inside-one-transaction shape a non-issue, the same tradeoff
   * already accepted elsewhere in this codebase for per-line loops.
   */
  replaceItems: (companyId: string, salesOrderId: string, headerData: Prisma.SalesOrderUncheckedUpdateInput, items: ReconciledSalesOrderItem[]) =>
    prisma.$transaction(async (tx) => {
      const existingItemIds = (await tx.salesOrderItem.findMany({ where: { salesOrderId }, select: { id: true } })).map(
        (i) => i.id
      );
      await tx.salesOrderItemBreakdown.deleteMany({ where: { salesOrderItemId: { in: existingItemIds } } });
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId } });

      for (const item of items) {
        let salesOrderLineId: string;
        if (item.lineLink.kind === "reuse") {
          salesOrderLineId = item.lineLink.salesOrderLineId;
        } else {
          const newLine = await tx.salesOrderLine.create({
            data: {
              companyId,
              salesOrderId,
              lineNumber: item.lineLink.lineNumber,
              sourceType: item.lineLink.sourceType,
              bomVersionId: item.lineLink.bomVersionId,
              sampleVersionId: item.lineLink.sampleVersionId,
              snapshotTakenAt: item.lineLink.snapshotTakenAt,
              snapshotTakenByUserId: item.lineLink.snapshotTakenByUserId,
            },
          });
          salesOrderLineId = newLine.id;
        }

        await tx.salesOrderItem.create({
          data: {
            salesOrderId,
            salesOrderLineId,
            productId: item.productId,
            sampleRequestId: item.sampleRequestId,
            unitPrice: item.unitPrice,
            notes: item.notes,
            breakdown: { create: item.breakdown },
          },
        });
      }

      await tx.salesOrder.update({ where: { id: salesOrderId }, data: headerData });

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

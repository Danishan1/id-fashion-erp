import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

/** Non-cancelled linked PurchaseOrderItems, with just enough of the PO's own
 * fields for shortfall/status math (orderedQuantity + the parent PO's
 * status) — shared by every include below that needs a line's escalation
 * state, since a line can now have more than one over its lifetime. */
const ACTIVE_PURCHASE_ORDER_ITEMS_INCLUDE = {
  where: { purchaseOrder: { status: { not: "CANCELLED" as const } } },
  select: {
    id: true,
    purchaseOrderId: true,
    orderedQuantity: true,
    purchaseOrder: { select: { id: true, orderNumber: true, status: true } },
  },
} as const;

const ITEM_INCLUDE = {
  material: { select: { id: true, styleName: true, styleCode: true, materialCategory: true, defaultSupplierId: true } },
  color: { select: { id: true, name: true, hexValue: true } },
  dye: { select: { id: true, name: true, pantone: true } },
  uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
  purchaseOrderItems: ACTIVE_PURCHASE_ORDER_ITEMS_INCLUDE,
  warehouseLocation: { select: { id: true, code: true, materialCategory: true } },
} as const;

/** A line is "locked" — untouchable by any future edit — the moment real
 * stock has been issued against it or a shortfall has been escalated to a
 * non-cancelled Purchase Order. Same real-state fact
 * assertNothingIssuedOrEscalated already checks at the whole-request level
 * for Cancel; this is the per-line version editing needs. */
const UNLOCKED_LINE_WHERE = (materialRequestId: string): Prisma.MaterialRequestItemWhereInput => ({
  materialRequestId,
  issuedQuantity: { lte: 0 },
  purchaseOrderItems: { none: { purchaseOrder: { status: { not: "CANCELLED" } } } },
});

export const MaterialRequestRepository = {
  findMany: (where: Prisma.MaterialRequestWhereInput, args: Omit<Prisma.MaterialRequestFindManyArgs, "where">) =>
    prisma.materialRequest.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        salesOrder: { select: { id: true, orderNumber: true } },
        requestedBy: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.MaterialRequestWhereInput) => prisma.materialRequest.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.materialRequest.findFirst({
      where: { id, companyId },
      include: {
        department: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        salesOrder: { select: { id: true, orderNumber: true } },
        bom: { select: { id: true, productId: true } },
        originalMaterialRequest: { select: { id: true, requestNumber: true } },
        requestedBy: { select: { id: true, fullName: true } },
        lines: { include: ITEM_INCLUDE, orderBy: { createdAt: "asc" } },
      },
    }),

  findAnyById: (companyId: string, id: string) =>
    prisma.materialRequest.findFirst({ where: { id, companyId }, include: { lines: true } }),

  createWithLines: (data: Prisma.MaterialRequestUncheckedCreateInput) =>
    prisma.materialRequest.create({ data, include: { lines: true } }),

  update: (id: string, data: Prisma.MaterialRequestUncheckedUpdateInput) =>
    prisma.materialRequest.update({ where: { id }, data }),

  /** Replace of a request's still-unlocked lines only — same "delete then
   * recreate" shape as PurchaseOrder's/the former PurchaseRequest's
   * replaceItems(), just scoped to the subset an edit is actually allowed to
   * touch. A locked line (real stock issued, or a shortfall escalated to a
   * non-cancelled Purchase Order) is never deleted here — it simply isn't
   * part of `lines`, since the caller only ever submits the unlocked
   * portion (see updateMaterialRequestLines) — so its id, issuedQuantity,
   * and any linked PurchaseOrderItem FK all survive an edit untouched. */
  replaceLines: (
    materialRequestId: string,
    headerData: Prisma.MaterialRequestUncheckedUpdateInput,
    lines: Prisma.MaterialRequestItemUncheckedCreateWithoutMaterialRequestInput[]
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.materialRequestItem.deleteMany({ where: UNLOCKED_LINE_WHERE(materialRequestId) });

      await tx.materialRequest.update({
        where: { id: materialRequestId },
        data: { ...headerData, lines: { create: lines } },
      });

      return tx.materialRequest.findFirstOrThrow({
        where: { id: materialRequestId },
        include: { lines: { include: ITEM_INCLUDE } },
      });
    }),

  /** Non-cancelled linked PurchaseOrderItems against this request's lines —
   * used to block cancellation once a shortfall has actually been escalated,
   * regardless of the request's current status label (including ON_HOLD),
   * same discipline as PurchaseOrderRepository.countActiveReceipts(). Queries
   * through PurchaseOrderItem's own to-one `materialRequestItem` relation,
   * which stayed a to-one even after that FK's uniqueness was dropped — so
   * this needs no change for multi-PO-per-line support. */
  countLinkedPurchaseOrderItems: (materialRequestId: string) =>
    prisma.purchaseOrderItem.count({
      where: { materialRequestItem: { materialRequestId }, purchaseOrder: { status: { not: "CANCELLED" } } },
    }),

  /** Any line that's had something issued against it — used, together with
   * the count above, to block cancelling the whole request once real stock
   * has actually moved (editing is gated per line instead — see
   * countLockedLines below). */
  countIssuedLines: (materialRequestId: string) =>
    prisma.materialRequestItem.count({ where: { materialRequestId, issuedQuantity: { gt: 0 } } }),

  /** How many of this request's lines are locked (the complement of
   * UNLOCKED_LINE_WHERE) — used by updateMaterialRequestLines to make sure a
   * request never ends up with zero lines total once its locked lines are
   * counted back in (they're excluded from the client's own submitted line
   * array, since replaceLines never touches them). */
  countLockedLines: (materialRequestId: string) =>
    prisma.materialRequestItem.count({
      where: {
        materialRequestId,
        OR: [{ issuedQuantity: { gt: 0 } }, { purchaseOrderItems: { some: { purchaseOrder: { status: { not: "CANCELLED" } } } } }],
      },
    }),

  /** Open (not CANCELLED/CLOSED) requests already carrying a real remaining
   * requirement for the same Sales Order + material — the candidate set for
   * the duplicate-request check. Filtered again in JS by the caller for
   * `requestedQuantity - issuedQuantity > 0`, since Prisma can't express a
   * column-to-column comparison in `where`. */
  findOpenDuplicateLines: (companyId: string, salesOrderId: string, materialId: string) =>
    prisma.materialRequestItem.findMany({
      where: {
        materialId,
        materialRequest: { companyId, salesOrderId, status: { notIn: ["CANCELLED", "CLOSED"] } },
      },
      select: {
        id: true,
        requestedQuantity: true,
        issuedQuantity: true,
        materialRequest: { select: { id: true, requestNumber: true } },
      },
    }),

  /** Not-CANCELLED/CLOSED requests already generated from this exact Sample
   * Version — the candidate set for the Sampling equivalent of the
   * duplicate-request warning above. A flat per-version check, not per-line:
   * a version's own material list doesn't have the shortfall/coverage math a
   * Sales Order's BOM explosion does, so "has anything already been
   * requested for this version" is the right granularity here. */
  findOpenBySampleVersion: (companyId: string, sampleVersionId: string) =>
    prisma.materialRequest.findMany({
      where: { companyId, sampleVersionId, status: { notIn: ["CANCELLED", "CLOSED"] } },
      select: { id: true, requestNumber: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
};

export const MaterialRequestItemRepository = {
  findById: (id: string) => prisma.materialRequestItem.findUnique({ where: { id } }),

  /** Company-scoped via the owning request — mirrors the exact pattern that
   * fixed this project's cross-tenant SampleMaterial bug. */
  findWithRequestOwner: (id: string) =>
    prisma.materialRequestItem.findUnique({
      where: { id },
      include: {
        material: { select: { id: true, styleName: true, materialCategory: true, baseUomId: true, baseUom: true } },
        uom: true,
        materialRequest: { select: { id: true, companyId: true, warehouseId: true, status: true, requestType: true } },
      },
    }),

  /** Guarded increment — the over-issue cap, expressed directly in the
   * `where` clause so two concurrent issue attempts against the same line
   * can never both succeed past requestedQuantity. Takes `tx` because the
   * guard and the ledger write it protects must commit or roll back together. */
  guardedIncrementIssued: (
    tx: Prisma.TransactionClient,
    lineId: string,
    requestedQuantity: number,
    incrementBy: number,
    warehouseLocationId?: string | null
  ) =>
    tx.materialRequestItem.updateMany({
      where: { id: lineId, issuedQuantity: { lte: requestedQuantity - incrementBy } },
      data: {
        issuedQuantity: { increment: incrementBy },
        // Traceability only — records the most recent pick location on the
        // line itself (not a full per-issue history, matching this project's
        // "cache-only convenience column" precedent, e.g. Lot.currentStageId).
        ...(warehouseLocationId !== undefined ? { warehouseLocationId } : {}),
      },
    }),

  /** Guarded increment for the Goods-Receipt-linked rollup — same idiom as
   * guardedIncrementIssued, capped at the sum of ordered quantity across this
   * line's active linked PurchaseOrderItems. Informational only: a lost race
   * (count === 0) or a failed UOM conversion is handled by the caller as a
   * fail-soft skip, never as a reason to abort the goods receipt itself. */
  guardedIncrementPurchaseReceived: (tx: Prisma.TransactionClient, lineId: string, cap: number, incrementBy: number) =>
    tx.materialRequestItem.updateMany({
      where: { id: lineId, purchaseReceivedQuantity: { lte: cap - incrementBy } },
      data: { purchaseReceivedQuantity: { increment: incrementBy } },
    }),

  /** Symmetric decrement for reverseGoodsReceiptLine() — plain, not guarded,
   * mirroring PurchaseOrderItemRepository.decrementReceived's own reversal
   * shape (the forward guard already protects the real invariant; a
   * reversal by definition only ever reduces a value that was validly
   * incremented). */
  decrementPurchaseReceived: (tx: Prisma.TransactionClient, lineId: string, decrementBy: number) =>
    tx.materialRequestItem.update({ where: { id: lineId }, data: { purchaseReceivedQuantity: { decrement: decrementBy } } }),

  /** What goods-receipt.service.ts needs, inside its own transaction, to
   * roll a receipt up into the originating Material Request line: the
   * line's own uom (for converting the received quantity into it) and the
   * cap (sum of ordered quantity across this line's active linked PO items)
   * the guarded increment above is bounded by. */
  findForReceiptRollupInTx: (tx: Prisma.TransactionClient, id: string) =>
    tx.materialRequestItem.findUnique({
      where: { id },
      include: {
        uom: { select: { id: true, name: true, baseUnitId: true, conversionFactor: true } },
        purchaseOrderItems: {
          where: { purchaseOrder: { status: { not: "CANCELLED" } } },
          select: { orderedQuantity: true },
        },
      },
    }),

  /** Every line on the request, with its material/uom and active linked PO
   * items — the service layer computes availableToOrderQuantity per line
   * from this and filters to what's actually eligible for a new PO
   * (replaces the old "purchaseOrderItem: null" filter, which stopped being
   * correct once a line could be partially escalated). */
  findLinesForShortfallGeneration: (materialRequestId: string) =>
    prisma.materialRequestItem.findMany({
      where: { materialRequestId },
      include: {
        material: { select: { id: true, styleName: true, styleCode: true, materialCategory: true, defaultSupplierId: true, unitCost: true } },
        uom: { select: { id: true, code: true } },
        purchaseOrderItems: ACTIVE_PURCHASE_ORDER_ITEMS_INCLUDE,
      },
    }),

  findManyForStatusRecompute: (materialRequestId: string) =>
    prisma.materialRequestItem.findMany({
      where: { materialRequestId },
      select: {
        requestedQuantity: true,
        issuedQuantity: true,
        purchaseOrderItems: {
          where: { purchaseOrder: { status: { not: "CANCELLED" } } },
          select: { orderedQuantity: true, purchaseOrder: { select: { status: true } } },
        },
      },
    }),
};

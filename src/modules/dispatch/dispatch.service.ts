import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { logger } from "@/core/logging/logger";
import { replaceCartonBarcodes } from "@/core/barcode/barcode.service";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { DispatchStatus, type Prisma } from "@prisma/client";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { ForwarderRepository } from "@/modules/forwarders/forwarder.repository";
import { recordInventoryTransaction, getAvailableQuantity } from "@/modules/inventory/inventory.service";
import { getDispatchSettings, extraDispatchNeedsApproval, type DispatchSettingsValue } from "@/core/dispatch-settings/DispatchSettingsService";
import { ProductVariantRepository } from "@/modules/products/product.repository";
import { WarehouseLocationRepository } from "@/modules/warehouses/warehouse.repository";
import {
  getFinishedGoodsAvailableForOrderLine,
  consumeReservationForDispatchInTx,
} from "@/modules/finished-goods-inventory/finished-goods-reservation.service";
import { getSalesOrderItemProductionSummary } from "@/modules/production/production-progress.service";
import type { DispatchInput, UpdateDispatchInput, SetCartonsInput, SetPickLinesInput } from "./dispatch.schema";
import { DispatchRepository } from "./dispatch.repository";

// Finished Goods Inventory module (FGI-040/041) — same sum-tolerance
// convention used project-wide (createLot()'s own LotVariantBreakdown check,
// Putaway's allocation sum check).
const PICK_LINE_EPSILON = 0.0001;

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

// A Dispatch may be created against an order that's CONFIRMED (the normal
// case), still PARTIALLY_DISPATCHED (a prior Dispatch already shipped part
// of it), already INVOICED (advance billing before shipment — a real,
// deliberately-supported ordering, not assumed to only happen after
// shipment), or already DISPATCHED.
//
// DISPATCHED was originally excluded here ("nothing left to ship") before
// Extra Dispatch Quantity existed — with it, that's no longer true: an
// order the Regular fulfillment logic already considers fully shipped can
// still legitimately need a further shipment (a replacement, a free/FOC
// piece, an extra sample) entirely as Extra. Re-including DISPATCHED here
// doesn't weaken anything — buildDispatchItems() still computes Regular=0
// for every line on such an order (remaining is already 0), so the whole
// quantity is forced through the Extra path: a reason is still required,
// the allowExtraDispatch/approval settings still apply, and Regular
// fulfillment (already 100%) is untouched.
const DISPATCH_ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED", "DISPATCHED"] as const;

/**
 * ON_HOLD is reachable only from DRAFT/PACKED — post-dispatch "hold" doesn't
 * correspond to a real floor action once goods have left (matching
 * Purchasing's own lesson: don't let CANCELLED-from-ON_HOLD reachability
 * quietly widen later). CANCELLED is independently and unconditionally
 * guarded at cancel time by whether `dispatchedAt` is set (see
 * cancelDispatch below) — this map is not the only line of defense.
 */
const ALLOWED_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  DRAFT: ["ON_HOLD", "CANCELLED"],
  PACKED: ["ON_HOLD", "CANCELLED"],
  DISPATCHED: ["REVERSED"],
  DELIVERED: ["REVERSED"],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
  REVERSED: [],
};

interface OrderItemLike {
  id: string;
  productId: string;
  // TOTAL physical quantity ever dispatched (regular + extra) — kept for
  // reference/display; NOT what remaining-to-dispatch is computed from
  // anymore (see regularDispatchedQuantity below).
  dispatchedQuantity: number;
  // Extra Dispatch Quantity (2026-09-30) — the portion of dispatchedQuantity
  // that counts toward Sale Order fulfillment; this is what "remaining"
  // must be based on, per the spec's own invariant ("Sale Order Fulfillment
  // = Regular Dispatch Only").
  regularDispatchedQuantity: number;
  breakdown: Array<{ orderedQuantity: number }>;
}

function orderedTotalOf(item: OrderItemLike): number {
  return item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
}

/** Remaining Order Qty = MAX(0, SO Qty - Already Regular Dispatched Qty). */
function remainingToDispatch(item: OrderItemLike): number {
  return Math.max(0, orderedTotalOf(item) - item.regularDispatchedQuantity);
}

/**
 * Extra Dispatch Quantity's own cumulative-Regular split (2026-09-30) —
 * NOT `MAX(0, dispatchQty - orderedTotal)`, which is wrong the instant a
 * second dispatch exists against the same line (see the spec's own
 * DSP-001/DSP-002 worked example). Regular is capped by what's genuinely
 * still remaining against the order right now; anything past that is Extra.
 */
function splitRegularExtra(item: OrderItemLike, dispatchQty: number): { regularQty: number; extraQty: number } {
  const remaining = remainingToDispatch(item);
  const regularQty = Math.min(dispatchQty, remaining);
  const extraQty = Math.max(0, dispatchQty - remaining);
  return { regularQty, extraQty };
}

async function buildDispatchItems(
  orderItems: OrderItemLike[],
  inputItems: DispatchInput["items"],
  settings: DispatchSettingsValue
) {
  const itemsById = new Map(orderItems.map((i) => [i.id, i]));
  const items = [];
  for (const line of inputItems) {
    const orderItem = itemsById.get(line.salesOrderItemId);
    if (!orderItem) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "One or more lines do not belong to the selected sales order.",
        { salesOrderItemId: line.salesOrderItemId }
      );
    }

    const { regularQty, extraQty } = splitRegularExtra(orderItem, line.dispatchedQuantity);

    if (extraQty > 0) {
      if (!settings.allowExtraDispatch) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Cannot dispatch ${line.dispatchedQuantity} for this line — only ${regularQty} remains against the sales order, and Extra Dispatch is disabled for this company.`,
          { salesOrderItemId: line.salesOrderItemId, requestedQuantity: line.dispatchedQuantity, remaining: regularQty }
        );
      }
      // "Extra Qty > 0 -> Extra Reason Required" (the spec's own invariant) —
      // enforced HERE, not in Zod, since the split above is only knowable
      // once the order's own cumulative Regular total is read; Zod's own
      // remarks-required-when-OTHER rule already ran on the raw input.
      if (!line.extraDispatchReason) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `${extraQty} of this line's ${line.dispatchedQuantity} pieces is Extra (beyond the ${regularQty} remaining on the sales order) — an Extra Dispatch Reason is required.`,
          { salesOrderItemId: line.salesOrderItemId, regularQty, extraQty }
        );
      }
    }

    items.push({
      salesOrderItemId: orderItem.id,
      productId: orderItem.productId,
      dispatchedQuantity: line.dispatchedQuantity,
      regularDispatchQuantity: regularQty,
      extraDispatchQuantity: extraQty,
      extraDispatchReason: extraQty > 0 ? (line.extraDispatchReason ?? null) : null,
      extraDispatchRemarks: extraQty > 0 ? (line.extraDispatchRemarks?.trim() || null) : null,
    });
  }
  return items;
}

const VALID_DISPATCH_STATUSES = new Set<string>(Object.values(DispatchStatus));

export async function listDispatches(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.DispatchWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { dispatchNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_DISPATCH_STATUSES.has(query.status) ? { status: query.status as DispatchStatus } : {}),
  };

  const [data, totalCount] = await Promise.all([
    DispatchRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    DispatchRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for a dispatch outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getDispatchById(actor: { companyId: string; userId: string }, id: string) {
  const dispatch = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!dispatch) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!dispatch.branchId || !allowedBranchIds.has(dispatch.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });
  }

  // The colour/size variants each line's Sales Order line ordered — the only
  // finished goods picking/packing may use (2026-10-22) — with this
  // warehouse's available Finished Goods stock for each.
  const orderedByItem = await getOrderedVariantsByDispatchItem(dispatch.items);
  const items = await Promise.all(
    dispatch.items.map(async (item) => ({
      ...item,
      orderedVariants: await Promise.all(
        (orderedByItem.get(item.id) ?? []).map(async (v) => ({
          ...v,
          availableQuantity: await getFinishedGoodsAvailableForOrderLine(
            actor.companyId,
            item.productId,
            v.productVariantId,
            dispatch.warehouseId,
            item.salesOrderItem?.salesOrderLineId ?? null
          ),
        }))
      ),
    }))
  );

  return { ...dispatch, items };
}

export interface SuggestedPickLine {
  dispatchItemId: string;
  productVariantId: string;
  /** null = stock not yet put away to a location. */
  warehouseLocationId: string | null;
  locationLabel: string;
  quantity: number;
}

/**
 * Auto-fill for picking (2026-10-22): for each colour/size the Sales Order
 * line ordered, the pieces still to ship (ordered minus what earlier
 * dispatches of this line already shipped), limited to the line's quantity
 * on this dispatch and to the Saleable Finished Goods available to this
 * order, taken from the locations that actually hold them (put-away
 * locations first, then stock not yet put away). Fills whatever is there —
 * a partial pick when stock is short. Read-only; the user reviews and saves.
 */
export async function getSuggestedPickLines(actor: { companyId: string; userId: string }, id: string): Promise<SuggestedPickLine[]> {
  const dispatch = await getDispatchById(actor, id);

  const shippedRows = await prisma.finishedGoodsPickLine.findMany({
    where: {
      companyId: actor.companyId,
      dispatchItem: {
        salesOrderItemId: { in: dispatch.items.map((i) => i.salesOrderItemId) },
        dispatch: { status: { in: ["DISPATCHED", "DELIVERED"] }, id: { not: dispatch.id } },
      },
    },
    select: { productVariantId: true, quantity: true, dispatchItem: { select: { salesOrderItemId: true } } },
  });
  const shipped = new Map<string, number>();
  for (const row of shippedRows) {
    const key = `${row.dispatchItem.salesOrderItemId}:${row.productVariantId}`;
    shipped.set(key, (shipped.get(key) ?? 0) + Number(row.quantity));
  }

  const lines: SuggestedPickLine[] = [];
  for (const item of dispatch.items) {
    let itemLeft = item.dispatchedQuantity;
    for (const variant of item.orderedVariants) {
      if (itemLeft <= 0) break;
      const stillToShip = variant.orderedQuantity - (shipped.get(`${item.salesOrderItemId}:${variant.productVariantId}`) ?? 0);
      let need = Math.min(stillToShip, itemLeft, Math.max(0, variant.availableQuantity));
      if (need <= 0) continue;

      const balances = await prisma.finishedGoodsStockBalance.findMany({
        where: {
          companyId: actor.companyId,
          productId: item.productId,
          productVariantId: variant.productVariantId,
          warehouseId: dispatch.warehouseId,
          stockStatus: "SALEABLE",
          quantityOnHand: { gt: 0 },
        },
        select: { warehouseLocationId: true, quantityOnHand: true, warehouseLocation: { select: { code: true } } },
      });
      balances.sort((a, b) => {
        if (!a.warehouseLocationId !== !b.warehouseLocationId) return a.warehouseLocationId ? -1 : 1;
        return (a.warehouseLocation?.code ?? "").localeCompare(b.warehouseLocation?.code ?? "");
      });
      for (const balance of balances) {
        if (need <= 0) break;
        const take = Math.min(need, Number(balance.quantityOnHand));
        if (take <= 0) continue;
        lines.push({
          dispatchItemId: item.id,
          productVariantId: variant.productVariantId,
          warehouseLocationId: balance.warehouseLocationId,
          locationLabel: balance.warehouseLocation?.code ?? "Not put away",
          quantity: take,
        });
        need -= take;
        itemLeft -= take;
      }
    }
  }
  return lines;
}

export interface OrderedVariant {
  productVariantId: string;
  colorName: string;
  sizeName: string;
  orderedQuantity: number;
}

/** dispatchItemId -> the colour/size variants its Sales Order line ordered (sorted by colour, then size order). */
async function getOrderedVariantsByDispatchItem(
  items: Array<{ id: string; salesOrderItemId: string }>
): Promise<Map<string, OrderedVariant[]>> {
  const salesOrderItemIds = [...new Set(items.map((i) => i.salesOrderItemId))];
  const rows = salesOrderItemIds.length
    ? await prisma.salesOrderItemBreakdown.findMany({
        where: { salesOrderItemId: { in: salesOrderItemIds } },
        select: {
          salesOrderItemId: true,
          productVariantId: true,
          orderedQuantity: true,
          productVariant: { select: { color: { select: { name: true } }, size: { select: { name: true, sortOrder: true } } } },
        },
      })
    : [];
  const sorted = [...rows].sort(
    (a, b) =>
      a.productVariant.color.name.localeCompare(b.productVariant.color.name) ||
      (a.productVariant.size.sortOrder ?? 0) - (b.productVariant.size.sortOrder ?? 0)
  );
  const result = new Map<string, OrderedVariant[]>();
  for (const item of items) {
    result.set(
      item.id,
      sorted
        .filter((r) => r.salesOrderItemId === item.salesOrderItemId)
        .map((r) => ({
          productVariantId: r.productVariantId,
          colorName: r.productVariant.color.name,
          sizeName: r.productVariant.size.name,
          orderedQuantity: Number(r.orderedQuantity),
        }))
    );
  }
  return result;
}

/** Refuses a colour/size the dispatch line's Sales Order line didn't order. */
function assertVariantWasOrdered(
  orderedByItem: Map<string, OrderedVariant[]>,
  dispatchItemId: string,
  productVariantId: string | null | undefined,
  styleName: string
) {
  const ordered = orderedByItem.get(dispatchItemId) ?? [];
  if (!productVariantId || ordered.length === 0) return;
  if (!ordered.some((v) => v.productVariantId === productVariantId)) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `This colour/size of "${styleName}" isn't on the Sales Order — only ${ordered.map((v) => `${v.colorName} / ${v.sizeName}`).join(", ")} can be dispatched.`,
      { dispatchItemId, productVariantId }
    );
  }
}

/**
 * Stock check at Draft time (create/edit), not just at Confirm — a Dispatch
 * should never be saved for more pieces than the chosen warehouse actually
 * holds. Other open (Draft/Packed) dispatches are NOT treated as reserving
 * stock — an abandoned draft must never block a real shipment; Confirm
 * re-checks live stock, so the same pieces can still only ship once.
 */
export interface DispatchableStock {
  onHand: number;
  reserved: number;
  available: number;
}

/** Per-style Finished Goods stock at a warehouse, plus (for information) what other open Draft/Packed dispatches mention. */
export async function getDispatchableStock(
  companyId: string,
  warehouseId: string,
  productIds: string[],
  excludeDispatchId?: string
): Promise<Map<string, DispatchableStock>> {
  const result = new Map<string, DispatchableStock>();
  for (const productId of new Set(productIds)) {
    const onHand = await getAvailableQuantity(companyId, productId, warehouseId);
    const reservedAgg = await prisma.dispatchItem.aggregate({
      where: {
        productId,
        dispatch: {
          companyId,
          warehouseId,
          status: { in: ["DRAFT", "PACKED"] },
          ...(excludeDispatchId ? { id: { not: excludeDispatchId } } : {}),
        },
      },
      _sum: { dispatchedQuantity: true },
    });
    const reserved = Number(reservedAgg._sum.dispatchedQuantity ?? 0);
    // `available` is the real on-hand stock. Draft/Packed dispatches do NOT
    // reserve stock (a stale or abandoned draft must never block a real
    // shipment) — `reserved` is returned for information only, and Confirm
    // re-checks live stock so two drafts can't both actually ship it.
    result.set(productId, { onHand, reserved, available: onHand });
  }
  return result;
}

async function assertFinishedGoodsAvailable(
  companyId: string,
  warehouseId: string,
  items: Array<{ productId: string; dispatchedQuantity: number }>,
  excludeDispatchId?: string
) {
  const requestedByProduct = new Map<string, number>();
  for (const item of items) {
    requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.dispatchedQuantity);
  }
  const stock = await getDispatchableStock(companyId, warehouseId, [...requestedByProduct.keys()], excludeDispatchId);

  for (const [productId, requested] of requestedByProduct) {
    const { onHand, reserved, available } = stock.get(productId)!;
    if (requested > available) {
      const product = await prisma.product.findFirst({ where: { id: productId, companyId }, select: { styleName: true } });
      const name = product?.styleName ?? "this style";
      throw new BusinessRuleError(
        "INSUFFICIENT_FG_STOCK",
        `Only ${available} pieces of "${name}" are in Finished Goods stock in this warehouse, but ${requested} were entered.`,
        { productId, warehouseId, onHand, reserved, available, requested }
      );
    }
  }
}

/** Optional, so most dispatches have nothing to validate — but when a
 * Forwarder IS picked, re-verify it's this company's own active row rather
 * than trusting a client-supplied id, same discipline Job Work Order's own
 * contractorId check already uses. */
async function resolveForwarderId(companyId: string, forwarderId: string | undefined): Promise<string | null> {
  if (!forwarderId) return null;
  const forwarder = await ForwarderRepository.findById(companyId, forwarderId);
  if (!forwarder) throw new BusinessRuleError("NOT_FOUND", "Transporter not found.", { id: forwarderId });
  if (!forwarder.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Transporter "${forwarder.name}" is inactive.`, { id: forwarder.id });
  }
  return forwarder.id;
}

/**
 * Release-to-Dispatch gate (2026-10-10) — opt-in by construction: a line
 * whose Sales Order Item has NO linked Production Order at all (Make-to-
 * Stock pools, orders never put through formal Production tracking) is
 * silently skipped, never blocked — this avoids any regression on existing
 * dispatch flows that don't use the Production module end-to-end. The gate
 * only fires when a real, non-cancelled Production Order genuinely exists
 * for the line AND hasn't been marked released yet. Mirrors Sales Order's
 * own "block, unless an elevated override reason is supplied" shape for its
 * sample-approval gate (assertSamplesApprovedOrOverride) — the override here
 * asserts `production`/`approve` (the permission the override itself needs),
 * same cross-module-assertion precedent as Material Request's own
 * generatePurchaseOrdersForShortfall().
 */
/** Returns the ids of any unreleased Production Orders the caller's override
 * reason just overrode (empty array if nothing needed overriding) — the
 * caller writes the actual audit entry once a real dispatch id exists,
 * rather than this pre-check writing one against a record that doesn't
 * exist yet. */
async function assertProductionReleasedForLines(
  actor: ActorContext,
  items: Array<{ salesOrderItemId: string; dispatchedQuantity: number }>,
  overrideReason: string | undefined
): Promise<string[]> {
  const lineIds = items.filter((i) => i.dispatchedQuantity > 0).map((i) => i.salesOrderItemId);
  if (lineIds.length === 0) return [];

  // CLOSED is excluded from the blocking set, not just CANCELLED — reaching
  // CLOSED already requires every lot to be COMPLETED/CANCELLED with at
  // least one real completion (see closeProductionOrder's own guard), so a
  // closed order is unambiguously "production finished" regardless of
  // whether anyone separately clicked Release — requiring that extra click
  // for something already fully done would be pure friction, not a real
  // check.
  const unreleasedOrders = await prisma.productionOrder.findMany({
    where: {
      salesOrderItemId: { in: lineIds },
      status: { notIn: ["CANCELLED", "CLOSED"] },
      releasedToDispatchAt: null,
    },
    select: { id: true, orderNumber: true, product: { select: { styleName: true } } },
  });
  if (unreleasedOrders.length === 0) return [];

  const trimmedReason = overrideReason?.trim();
  if (!trimmedReason) {
    const names = unreleasedOrders.map((o) => `${o.orderNumber} (${o.product.styleName})`).join(", ");
    throw new BusinessRuleError(
      "PRODUCTION_NOT_RELEASED_TO_DISPATCH",
      `Cannot create this dispatch — production has not been released to dispatch yet for: ${names}. A Production Manager must click "Release to Dispatch" on the relevant Production Order, or a Management user may override with a reason.`,
      { unreleasedProductionOrderIds: unreleasedOrders.map((o) => o.id) }
    );
  }

  await PermissionService.assert(actor.userId, "production", "approve");
  return unreleasedOrders.map((o) => o.id);
}

/**
 * Real-produced-quantity gate (process-flow clarity fix, 2026-10-15/16) — a
 * line's cumulative REGULAR dispatched quantity
 * (`SalesOrderItem.regularDispatchedQuantity`, which only ever changes at
 * confirmDispatch's own commit point, plus this request's own Regular
 * quantity) must never exceed what has ACTUALLY completed the production
 * flow's FINAL stage ("Packing") for that line — reusing
 * getSalesOrderItemProductionSummary()'s own totalProduced figure (summed
 * from JobOrders sitting on a `ProductionStage.isFinal` stage only, never
 * re-derived here) rather than inventing a second computation that could
 * drift from it.
 *
 * This closes a real gap the pooled-stock check above (assertFinishedGoods
 * Available) can't: that check only reads the warehouse's flat FG
 * StockBalance/FinishedGoodsStockBalance total, which CAN legitimately
 * contain quantity that never went through Packing for this specific order
 * line — a Finished-Goods Stock Movement "stock found" Adjustment, an
 * Opening Stock import, or genuinely Packing-complete stock from a
 * DIFFERENT Sales Order line sharing the same style/warehouse (FG stock is
 * pooled once it reaches the ledger). Scoping the check per line, against
 * real production output, is what actually prevents "wrong entry" dispatches
 * un-traceable to a real Packing completion.
 *
 * Deliberately scoped to the REGULAR portion only, never the Extra portion —
 * Extra Dispatch Quantity's own documented invariant (2026-09-30) is "Sale
 * Order Fulfillment = Regular Dispatch Only": an Extra piece is, by design,
 * never counted toward this line's own production/order allocation at all
 * (a replacement, a free/FOC piece, a sample — legitimately sourced from
 * whatever real Finished Goods stock the company actually has, including a
 * different order's surplus or a stock-adjustment find). Capping Extra by
 * this line's own Packing output would silently defeat that feature. Extra
 * stays bound by the general, real-stock checks instead
 * (assertFinishedGoodsAvailable above and confirmDispatch's own stock
 * re-check, both of which already apply to the TOTAL regular+extra quantity
 * and never let Extra bypass a genuine stock-availability check).
 *
 * Deliberately has NO override — unlike the manual Release-to-Dispatch click
 * above (a human judgment call: "is this actually ready"), this is a plain
 * physical fact: units nobody has finished producing cannot be shipped
 * toward this order's own Regular fulfillment, so there is nothing for a
 * judgment call to override (Extra Dispatch is the designed escape hatch for
 * exactly this situation). Opt-in by construction, same as
 * assertProductionReleasedForLines: every DispatchItem in this app is always
 * tied to a real Sales Order line (Dispatch.salesOrderId is required), so
 * there is no Make-to-Stock case to skip here.
 */
async function assertPackingProducedForLines(
  companyId: string,
  items: Array<{ salesOrderItemId: string; regularDispatchQuantity: number }>
) {
  const requestedByLine = new Map<string, number>();
  for (const item of items) {
    requestedByLine.set(item.salesOrderItemId, (requestedByLine.get(item.salesOrderItemId) ?? 0) + item.regularDispatchQuantity);
  }

  for (const [salesOrderItemId, requested] of requestedByLine) {
    if (requested <= 0) continue;

    const orderItem = await prisma.salesOrderItem.findFirst({
      where: { id: salesOrderItemId, salesOrder: { companyId } },
      select: { regularDispatchedQuantity: true, product: { select: { styleName: true } } },
    });
    if (!orderItem) continue; // validated as belonging to the order already (buildDispatchItems)

    const summary = await getSalesOrderItemProductionSummary(companyId, salesOrderItemId);
    const alreadyRegularDispatched = orderItem.regularDispatchedQuantity;
    const remainingPacked = Math.max(0, summary.totalProduced - alreadyRegularDispatched);

    if (requested > remainingPacked) {
      throw new BusinessRuleError(
        "PACKING_QUANTITY_NOT_AVAILABLE",
        `Only ${remainingPacked} pieces of "${orderItem.product.styleName}" have actually completed the final production stage (Packing) and are available for Regular fulfillment of this order line, but ${requested} were entered as Regular. Total produced (Packing-complete) for this line: ${summary.totalProduced}, already regular-dispatched: ${alreadyRegularDispatched}. (Extra Dispatch Quantity, with a reason, can draw on general Finished Goods stock instead.)`,
        { salesOrderItemId, requested, alreadyRegularDispatched, totalProduced: summary.totalProduced, remainingPacked }
      );
    }
  }
}

export async function createDispatch(actor: ActorContext, input: DispatchInput) {
  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, input.salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: input.salesOrderId });

  if (!(DISPATCH_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot dispatch a sales order in "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }

  const settings = await getDispatchSettings(actor.companyId);
  const items = await buildDispatchItems(order.items, input.items, settings);
  await assertFinishedGoodsAvailable(actor.companyId, input.warehouseId, items);
  const overriddenProductionOrderIds = await assertProductionReleasedForLines(
    actor,
    items,
    input.overrideProductionReleaseReason
  );
  await assertPackingProducedForLines(actor.companyId, items);
  const forwarderId = await resolveForwarderId(actor.companyId, input.forwarderId);

  const dispatchNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "DISPATCH",
  });

  const dispatch = await DispatchRepository.createWithItems(
    {
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      dispatchNumber,
      salesOrderId: order.id,
      customerId: order.customerId,
      warehouseId: input.warehouseId,
      dispatchDate: new Date(input.dispatchDate),
      status: "DRAFT",
      deliveryAddress: input.deliveryAddress,
      transporterName: input.transporterName || null,
      vehicleNumber: input.vehicleNumber || null,
      trackingNumber: input.trackingNumber || null,
      forwarderId,
      lrNumber: input.lrNumber || null,
      awbNumber: input.awbNumber || null,
      driverDetails: input.driverDetails || null,
      freightCharges: input.freightCharges ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      shipmentRemarks: input.shipmentRemarks || null,
      requestedByUserId: actor.userId,
    },
    items
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: dispatch.id,
    action: "CREATE",
    newValues: { dispatchNumber: dispatch.dispatchNumber, salesOrderId: order.id },
  });

  if (overriddenProductionOrderIds.length > 0) {
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "dispatches",
      recordId: dispatch.id,
      action: "UPDATE",
      newValues: {
        productionReleaseOverrideReason: input.overrideProductionReleaseReason?.trim(),
        overriddenProductionOrderIds,
      },
    });
  }

  return dispatch;
}

/** Editable while DRAFT or PACKED — replacing items also clears any existing
 * Cartons (they'd otherwise reference deleted DispatchItem rows) and reopens
 * the Dispatch to DRAFT, since whatever was packed no longer corresponds to
 * the new item set. */
export async function updateDispatch(actor: ActorContext, id: string, input: UpdateDispatchInput) {
  const existing = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, existing.salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: existing.salesOrderId });

  // This dispatch's own not-yet-confirmed lines don't count against
  // "remaining" — only regularDispatchedQuantity (from OTHER, already-
  // confirmed dispatches) does, so re-editing the same DRAFT dispatch's own
  // quantities isn't blocked by itself; Regular/Extra are recomputed fresh
  // on every edit rather than stored as independent input.
  const settings = await getDispatchSettings(actor.companyId);
  const items = await buildDispatchItems(order.items, input.items, settings);
  await assertFinishedGoodsAvailable(actor.companyId, input.warehouseId, items, id);
  const overriddenProductionOrderIds = await assertProductionReleasedForLines(
    actor,
    items,
    input.overrideProductionReleaseReason
  );
  await assertPackingProducedForLines(actor.companyId, items);
  const forwarderId = await resolveForwarderId(actor.companyId, input.forwarderId);

  const updated = await DispatchRepository.replaceItems(
    id,
    {
      warehouseId: input.warehouseId,
      dispatchDate: new Date(input.dispatchDate),
      deliveryAddress: input.deliveryAddress,
      transporterName: input.transporterName || null,
      vehicleNumber: input.vehicleNumber || null,
      trackingNumber: input.trackingNumber || null,
      forwarderId,
      lrNumber: input.lrNumber || null,
      awbNumber: input.awbNumber || null,
      driverDetails: input.driverDetails || null,
      freightCharges: input.freightCharges ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      shipmentRemarks: input.shipmentRemarks || null,
    },
    items
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: "DRAFT", itemCount: updated.items.length },
  });

  if (overriddenProductionOrderIds.length > 0) {
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "dispatches",
      recordId: id,
      action: "UPDATE",
      newValues: {
        productionReleaseOverrideReason: input.overrideProductionReleaseReason?.trim(),
        overriddenProductionOrderIds,
      },
    });
  }

  return updated;
}

/** Editable while DRAFT or PACKED — packing is a real multi-step floor
 * process that can span both; markPacked/confirmDispatch re-validate
 * completeness regardless of which status label the caller is coming from. */
export async function setCartons(actor: ActorContext, id: string, input: SetCartonsInput) {
  const existing = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit cartons for a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const dispatchItemProductId = new Map(existing.items.map((i) => [i.id, i.productId]));
  const dispatchItemEligibleQuantity = new Map(existing.items.map((i) => [i.id, i.dispatchedQuantity]));
  const dispatchItemStyleName = new Map(existing.items.map((i) => [i.id, i.product.styleName]));

  const uniqueProductIds = [...new Set(existing.items.map((i) => i.productId))];
  const activeVariantsByProduct = new Map<string, boolean>(
    await Promise.all(
      uniqueProductIds.map(async (productId) => [productId, (await ProductVariantRepository.findManyActiveByProductId(productId)).length > 0] as const)
    )
  );

  const orderedByItem = await getOrderedVariantsByDispatchItem(existing.items);
  const variantIds = [...new Set(input.cartons.flatMap((c) => c.items.map((i) => i.productVariantId).filter(Boolean)))] as string[];
  const variants = variantIds.length > 0 ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } } }) : [];
  const variantProductId = new Map(variants.map((v) => [v.id, v.productId]));

  const cartons = input.cartons.map((carton, index) => {
    for (const item of carton.items) {
      const expectedProductId = dispatchItemProductId.get(item.dispatchItemId);
      if (!expectedProductId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A carton line does not belong to this dispatch.",
          { dispatchItemId: item.dispatchItemId }
        );
      }
      const hasActiveVariants = Boolean(activeVariantsByProduct.get(expectedProductId));
      if (hasActiveVariants && !item.productVariantId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `A carton line for "${dispatchItemStyleName.get(item.dispatchItemId)}" does not specify a colour/size variant.`,
          { dispatchItemId: item.dispatchItemId }
        );
      }
      if (item.productVariantId && variantProductId.get(item.productVariantId) !== expectedProductId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A carton line's variant does not match its style.",
          { dispatchItemId: item.dispatchItemId, productVariantId: item.productVariantId }
        );
      }
      assertVariantWasOrdered(orderedByItem, item.dispatchItemId, item.productVariantId, dispatchItemStyleName.get(item.dispatchItemId) ?? "this style");
    }
    return {
      cartonNumber: index + 1,
      totalQuantity: carton.items.reduce((sum, i) => sum + i.quantity, 0),
      items: carton.items.map((i) => ({
        dispatchItemId: i.dispatchItemId,
        productVariantId: i.productVariantId || null,
        quantity: i.quantity,
      })),
    };
  });

  // Early, non-authoritative stock-quantity-control fix (process-flow
  // clarity, 2026-10-16) — a carton's own quantity must never exceed what was
  // actually approved for this DispatchItem to ship, which is itself already
  // capped (at create/update/confirm) to what genuinely completed Packing —
  // see assertPackingProducedForLines above. Previously this was only ever
  // caught at markPacked()'s own exact-sum check, well after a user had
  // already saved and walked away from an invalid carton split; checking it
  // here too gives the same feedback the moment cartons are saved, matching
  // the "validate both when saving and when confirming" requirement.
  // Deliberately `<=`, not `===` — a partial, still-in-progress carton save
  // (not every piece assigned to a carton yet) stays valid here; markPacked()
  // is still the one place that requires the sum to be exactly complete.
  const packedByItemId = new Map<string, number>();
  for (const carton of cartons) {
    for (const item of carton.items) {
      packedByItemId.set(item.dispatchItemId, (packedByItemId.get(item.dispatchItemId) ?? 0) + item.quantity);
    }
  }
  for (const [dispatchItemId, packed] of packedByItemId) {
    const eligible = dispatchItemEligibleQuantity.get(dispatchItemId) ?? 0;
    if (packed > eligible) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Cartons for "${dispatchItemStyleName.get(dispatchItemId)}" total ${packed} pieces, which exceeds the ${eligible} pieces eligible to be packed/dispatched for this line.`,
        { dispatchItemId, packed, eligible }
      );
    }
  }

  const updated = await DispatchRepository.setCartons(id, cartons);

  // Best-effort: cartons are deleted and recreated with fresh ids on every
  // call (see DispatchRepository.setCartons), so the prior call's own CARTON
  // barcode rows are dangling the instant new ones exist — replaceCartonBarcodes
  // cleans those up and registers a fresh one per new carton. Never allowed
  // to fail the real carton write itself, same reasoning as
  // mintFabricRollBarcode/registerProductionLotBarcode above.
  try {
    await replaceCartonBarcodes(
      { companyId: actor.companyId, userId: actor.userId },
      {
        previousCartonIds: existing.cartons.map((c) => c.id),
        dispatchNumber: existing.dispatchNumber,
        newCartons: updated.cartons.map((c) => ({ id: c.id, cartonNumber: c.cartonNumber })),
      }
    );
  } catch (err) {
    logger.error("Failed to replace Carton barcodes after setCartons", { error: err, dispatchId: id });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    newValues: { cartonCount: cartons.length },
  });

  return updated;
}

/**
 * Finished Goods Inventory module (FGI-040) — multi-location picking. Full
 * replace of a Dispatch's FinishedGoodsPickLine rows across every one of its
 * DispatchItems in one call (same "simplest correct way to apply an edit"
 * reasoning as setCartons above). Editable while DRAFT or PACKED, same
 * floor-process reasoning as setCartons/markPacked — picking and packing are
 * independent concerns that both span the same two statuses. Partial picks
 * (less than a DispatchItem's own dispatchedQuantity) are a valid,
 * intermediate state here; only confirmDispatch() requires completeness
 * (§7 point 3 of the implementation plan).
 */
export async function setPickLines(actor: ActorContext, id: string, input: SetPickLinesInput) {
  const existing = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit picking for a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const itemById = new Map(existing.items.map((i) => [i.id, i]));

  const orderedByItem = await getOrderedVariantsByDispatchItem(existing.items);
  const variantIds = [...new Set(input.pickLines.map((l) => l.productVariantId))];
  const variants = variantIds.length > 0 ? await ProductVariantRepository.findManyByIds(variantIds) : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const locationIds = [...new Set(input.pickLines.map((l) => l.warehouseLocationId).filter((x): x is string => !!x))];
  const locationEntries = await Promise.all(
    locationIds.map(async (locationId) => [locationId, await WarehouseLocationRepository.findByIdWithWarehouse(locationId)] as const)
  );
  const locationById = new Map(locationEntries);

  for (const line of input.pickLines) {
    const item = itemById.get(line.dispatchItemId);
    if (!item) {
      throw new BusinessRuleError("VALIDATION_ERROR", "A pick line does not belong to this dispatch.", {
        dispatchItemId: line.dispatchItemId,
      });
    }

    const variant = variantById.get(line.productVariantId);
    if (!variant || variant.productId !== item.productId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `A pick line's colour/size variant does not match "${item.product.styleName}".`,
        { dispatchItemId: line.dispatchItemId, productVariantId: line.productVariantId }
      );
    }
    assertVariantWasOrdered(orderedByItem, line.dispatchItemId, line.productVariantId, item.product.styleName);

    // No location = stock not yet put away (staging) — nothing more to check.
    if (!line.warehouseLocationId) continue;
    const location = locationById.get(line.warehouseLocationId);
    if (!location || location.warehouse.companyId !== actor.companyId) {
      throw new BusinessRuleError("NOT_FOUND", "Warehouse location not found.", { id: line.warehouseLocationId });
    }
    if (location.warehouseId !== existing.warehouseId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "A pick line's location must belong to this dispatch's own warehouse.",
        { warehouseLocationId: line.warehouseLocationId, warehouseId: existing.warehouseId }
      );
    }
  }

  const updated = await DispatchRepository.setPickLines(
    id,
    input.pickLines.map((l) => ({
      dispatchItemId: l.dispatchItemId,
      productVariantId: l.productVariantId,
      warehouseLocationId: l.warehouseLocationId || null,
      quantity: l.quantity,
      companyId: actor.companyId,
      pickedByUserId: actor.userId,
    }))
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    newValues: { pickLineCount: input.pickLines.length },
  });

  return updated;
}

/**
 * DRAFT/PACKED -> PACKED. Validates, per DispatchItem, that the sum of its
 * carton-item quantities across every carton exactly equals its own
 * dispatchedQuantity — every line actually packed, not just an aggregate
 * total that happens to match by coincidence across different items.
 *
 * `scannedCartonIds` is optional (2026-09-29, Barcode Management & Scanning
 * System Phase 1) — when the pack screen has the warehouse user scan every
 * physical carton's label before confirming, this cross-checks that the
 * scanned set is EXACTLY the dispatch's own real carton set (same cardinality,
 * no missing carton, no carton scanned twice, no stray carton from a
 * different dispatch) before the existing quantity validation below even
 * runs. Every existing caller omits it and behaves identically to before.
 */
export async function markPacked(actor: ActorContext, id: string, scannedCartonIds?: string[]) {
  const existing = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot pack a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  if (scannedCartonIds) {
    const realCartonIds = new Set(existing.cartons.map((c) => c.id));
    const scannedSet = new Set(scannedCartonIds);
    if (scannedSet.size !== scannedCartonIds.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", "The same carton was scanned more than once.", {});
    }
    const missing = existing.cartons.filter((c) => !scannedSet.has(c.id));
    const unexpected = scannedCartonIds.filter((cid) => !realCartonIds.has(cid));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        missing.length > 0
          ? `Carton #${missing[0].cartonNumber} has not been scanned yet.`
          : "A scanned carton does not belong to this dispatch.",
        { missingCartonNumbers: missing.map((c) => c.cartonNumber), unexpectedCartonIds: unexpected }
      );
    }
  }

  const uniqueProductIds = [...new Set(existing.items.map((i) => i.productId))];
  const activeVariantsByProduct = new Map<string, boolean>(
    await Promise.all(
      uniqueProductIds.map(async (productId) => [productId, (await ProductVariantRepository.findManyActiveByProductId(productId)).length > 0] as const)
    )
  );

  const packedByItemId = new Map<string, number>();
  for (const carton of existing.cartons) {
    for (const cartonItem of carton.items) {
      const hasActiveVariants = Boolean(activeVariantsByProduct.get(cartonItem.dispatchItem.productId));
      if (hasActiveVariants && !cartonItem.productVariantId) {
        const item = existing.items.find((i) => i.id === cartonItem.dispatchItem.id);
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `A packed carton item for "${item?.product.styleName ?? "this style"}" does not specify a valid colour/size variant.`,
          { cartonId: carton.id, dispatchItemId: cartonItem.dispatchItem.id }
        );
      }
      packedByItemId.set(
        cartonItem.dispatchItem.id,
        (packedByItemId.get(cartonItem.dispatchItem.id) ?? 0) + cartonItem.quantity
      );
    }
  }

  for (const item of existing.items) {
    const packed = packedByItemId.get(item.id) ?? 0;
    if (packed !== item.dispatchedQuantity) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Packed quantity (${packed}) for "${item.product.styleName}" does not match the quantity to dispatch (${item.dispatchedQuantity}).`,
        { dispatchItemId: item.id, packed, expected: item.dispatchedQuantity }
      );
    }
  }

  const { count } = await DispatchRepository.updateStatusConditional(id, existing.status, { status: "PACKED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch's status changed — reload and try again.", {});
  }

  const updated = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: "PACKED" },
  });

  return updated;
}

/**
 * PACKED -> DISPATCHED. Self-approval-guarded via "post" (mirroring Invoice/
 * Journal's precedent — this is posting a ledger-affecting confirmation, not
 * approving someone else's request, so "post" is the right verb, not
 * Payment's "approve"). Extra Dispatch Quantity (2026-09-30): when this
 * dispatch's own extra quantity requires sign-off (per DispatchSettings — a
 * blanket company requirement, or either configured threshold), a SECOND,
 * separately self-approval-guarded "approve" assert additionally runs before
 * anything is posted — Reason (why) and Approval (a real sign-off) are
 * deliberately different checkpoints, not the same click. One transaction:
 * for each DispatchItem — a pre-check against real FG stock
 * (INSUFFICIENT_FG_STOCK, checked against the TOTAL regular+extra quantity —
 * extra dispatch never bypasses this), a guarded increment of
 * SalesOrderItem.regularDispatchedQuantity ONLY (capped by a FRESH read of
 * sum(breakdown.orderedQuantity) inside this same transaction — safe with
 * the plain Prisma updateMany idiom, not raw SQL, because updateSalesOrder()
 * now blocks edits while any Dispatch references the order, so that sum
 * cannot move underneath this transaction; dispatchedQuantity, the TOTAL,
 * is incremented unconditionally in the same write — extra is never capped
 * by the order's own quantity, only by real stock, already checked above),
 * and a negative DISPATCH InventoryTransaction for the total physical
 * quantity. Then a fresh-read-plus-unconditional-write recompute of
 * SalesOrder.status — Regular-only, per the spec's own invariant ("Sale
 * Order Fulfillment = Regular Dispatch Only") — same idiom as goods-
 * receipt.service.ts's own received-quantity recompute (not a guarded
 * conditional transition, since multiple Dispatches over time have no single
 * "expected prior status").
 */
export async function confirmDispatch(actor: ActorContext, id: string) {
  const dispatch = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!dispatch) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await PermissionService.assert(actor.userId, "dispatch", "post", { createdBy: dispatch.requestedByUserId });

  if (dispatch.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot confirm a dispatch in "${dispatch.status}" status — it must be Packed first.`,
      { currentStatus: dispatch.status }
    );
  }

  // Pre-check against real FG stock — the same "pre-check is enough, a
  // hot-path race guard isn't warranted for a manual, low-frequency action"
  // tradeoff already accepted project-wide for Stock Movement's own
  // negative-quantity paths, applied consistently here. Checked against the
  // TOTAL (regular+extra) — extra dispatch never bypasses this gate.
  for (const item of dispatch.items) {
    const available = await getAvailableQuantity(actor.companyId, item.productId, dispatch.warehouseId);
    if (item.dispatchedQuantity > available) {
      throw new BusinessRuleError(
        "INSUFFICIENT_FG_STOCK",
        `Unable to confirm dispatch because ${item.dispatchedQuantity} pieces of "${item.product.styleName}" are not available in Finished Goods stock. Available: ${available}, Requested: ${item.dispatchedQuantity}.`,
        { productId: item.productId, warehouseId: dispatch.warehouseId, available, requested: item.dispatchedQuantity }
      );
    }
  }

  // Live re-check of the same Packing-produced-quantity gate createDispatch/
  // updateDispatch already pre-checked — this is the real, authoritative
  // check (the one that matters for a race between two drafts against the
  // same line, mirroring the FG-stock check's own pre-check/confirm-recheck
  // split immediately above).
  await assertPackingProducedForLines(
    actor.companyId,
    dispatch.items.map((item) => ({ salesOrderItemId: item.salesOrderItem.id, regularDispatchQuantity: item.regularDispatchQuantity }))
  );

  // Finished Goods Inventory module (FGI-040/041) — §7 point 1: "the
  // pre-check is extended, not replaced." The style-level loop above stays
  // exactly as it was; this is a SECOND, additional check underneath it. A
  // style with zero configured ACTIVE variants keeps today's flat-only path
  // untouched and never requires pick lines at all (same precedent as
  // Phase 2's own FGI-020 breakdown requirement).
  const uniqueProductIds = [...new Set(dispatch.items.map((i) => i.productId))];
  const activeVariantsByProduct = new Map<string, boolean>(
    await Promise.all(
      uniqueProductIds.map(async (productId) => [productId, (await ProductVariantRepository.findManyActiveByProductId(productId)).length > 0] as const)
    )
  );

  const itemsNeedingPickLines = dispatch.items.filter((item) => activeVariantsByProduct.get(item.productId));

  for (const item of itemsNeedingPickLines) {
    const pickedTotal = item.pickLines.reduce((sum, line) => sum + Number(line.quantity), 0);
    if (Math.abs(pickedTotal - item.dispatchedQuantity) > PICK_LINE_EPSILON) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${item.product.styleName}" has colour/size variants configured — its picked quantity (${pickedTotal}) must exactly equal the quantity to dispatch (${item.dispatchedQuantity}) before this dispatch can be confirmed. Use Pick Lines to allocate the remainder.`,
        { dispatchItemId: item.id, picked: pickedTotal, expected: item.dispatchedQuantity }
      );
    }

    // Variant-wise reconciliation between CartonItem and FinishedGoodsPickLine
    const itemCartonLines = (dispatch.cartons ?? []).flatMap((c) =>
      c.items.filter((ci) => ci.dispatchItem?.id === item.id || (ci as unknown as { dispatchItemId?: string }).dispatchItemId === item.id)
    );

    for (const cartonItem of itemCartonLines) {
      if (!cartonItem.productVariantId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `A packed carton item for "${item.product.styleName}" does not specify a valid colour/size variant.`,
          { dispatchItemId: item.id }
        );
      }
    }

    const packedByVariantForItem = new Map<string, number>();
    for (const cartonItem of itemCartonLines) {
      const vId = cartonItem.productVariantId!;
      packedByVariantForItem.set(vId, (packedByVariantForItem.get(vId) ?? 0) + cartonItem.quantity);
    }

    const pickedByVariantForItem = new Map<string, number>();
    for (const line of item.pickLines) {
      const vId = line.productVariantId;
      pickedByVariantForItem.set(vId, (pickedByVariantForItem.get(vId) ?? 0) + Number(line.quantity));
    }

    const allVariantIdsForItem = new Set([...packedByVariantForItem.keys(), ...pickedByVariantForItem.keys()]);
    for (const variantId of allVariantIdsForItem) {
      const packedQty = packedByVariantForItem.get(variantId) ?? 0;
      const pickedQty = pickedByVariantForItem.get(variantId) ?? 0;
      if (Math.abs(packedQty - pickedQty) > PICK_LINE_EPSILON) {
        const variantLine = item.pickLines.find((pl) => pl.productVariantId === variantId);
        const cartonLine = itemCartonLines.find((cl) => cl.productVariantId === variantId);
        const variantObj = variantLine?.productVariant ?? cartonLine?.productVariant;
        const variantLabel = variantObj?.color?.name && variantObj?.size?.name
          ? ` (${variantObj.color.name} / ${variantObj.size.name})`
          : "";
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Packed carton quantity for "${item.product.styleName}"${variantLabel} does not match the picked quantity from inventory. Packed: ${packedQty}, Picked: ${pickedQty}.`,
          { dispatchItemId: item.id, productVariantId: variantId, packed: packedQty, picked: pickedQty }
        );
      }
    }
  }

  // §7 point 1's own real rule: "the sum of a dispatch's own
  // FinishedGoodsPickLine for a given variant must not exceed that variant's
  // own Available figure" — aggregated PER VARIANT across the whole
  // dispatch (never per DispatchItem alone), since the same variant could in
  // principle be picked across more than one line/item.
  const pickedByVariant = new Map<string, number>();
  for (const item of itemsNeedingPickLines) {
    for (const line of item.pickLines) {
      pickedByVariant.set(line.productVariantId, (pickedByVariant.get(line.productVariantId) ?? 0) + Number(line.quantity));
    }
  }

  for (const [productVariantId, pickedQuantity] of pickedByVariant) {
    const owningItem = itemsNeedingPickLines.find((item) => item.pickLines.some((line) => line.productVariantId === productVariantId))!;
    const variantLine = owningItem.pickLines.find((line) => line.productVariantId === productVariantId)!;
    // Stock reserved for this dispatch's own order line counts as available to it.
    const available = await getFinishedGoodsAvailableForOrderLine(
      actor.companyId,
      owningItem.productId,
      productVariantId,
      dispatch.warehouseId,
      owningItem.salesOrderItem?.salesOrderLineId ?? null
    );
    if (pickedQuantity > available) {
      throw new BusinessRuleError(
        "INSUFFICIENT_FG_STOCK",
        `Unable to confirm dispatch because ${pickedQuantity} pieces of "${owningItem.product.styleName}" (${variantLine.productVariant.color.name} / ${variantLine.productVariant.size.name}) are not available in Finished Goods stock at this specific variant level. Available: ${available}, Requested: ${pickedQuantity}.`,
        { productId: owningItem.productId, productVariantId, warehouseId: dispatch.warehouseId, available, requested: pickedQuantity }
      );
    }
  }

  const totalRegular = dispatch.items.reduce((sum, i) => sum + i.regularDispatchQuantity, 0);
  const totalExtra = dispatch.items.reduce((sum, i) => sum + i.extraDispatchQuantity, 0);
  const settings = await getDispatchSettings(actor.companyId);
  const needsApproval = extraDispatchNeedsApproval(settings, { totalRegular, totalExtra });
  if (needsApproval) {
    // Genuinely separate from "post" above — the same actor may hold both
    // (e.g. SUPER_ADMIN), but a role that holds only "post" (e.g.
    // DISPATCH_MANAGER, who packs/ships the ordinary case) will be denied
    // here with a clean PERMISSION_DENIED, and the creator of this dispatch
    // still cannot approve their own extra quantity even if they do hold
    // "approve" — "approve" is already self-approval-guarded project-wide.
    await PermissionService.assert(actor.userId, "dispatch", "approve", { createdBy: dispatch.requestedByUserId });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of dispatch.items) {
      const orderItem = await tx.salesOrderItem.findUniqueOrThrow({
        where: { id: item.salesOrderItem.id },
        select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
      });
      const orderedTotal = orderItem.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);

      const { count } = await tx.salesOrderItem.updateMany({
        where: {
          id: item.salesOrderItem.id,
          regularDispatchedQuantity: { lte: orderedTotal - item.regularDispatchQuantity },
        },
        data: {
          regularDispatchedQuantity: { increment: item.regularDispatchQuantity },
          dispatchedQuantity: { increment: item.dispatchedQuantity },
        },
      });
      if (count === 0) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Cannot dispatch ${item.dispatchedQuantity} for "${item.product.styleName}" — the remaining order quantity changed.`,
          { salesOrderItemId: item.salesOrderItem.id }
        );
      }

      // Finished Goods Inventory module (FGI-040/041) — §7 point 2: the
      // existing per-DispatchItem posting becomes one recordInventoryTransaction()
      // call PER PICK LINE for a variant-bearing style; the SUM across those
      // calls for this one item is still posted into the exact same flat
      // StockBalance update as before (recordInventoryTransaction()'s own
      // unconditional flat-balance branch runs on every call regardless of
      // whether a variant/location is also supplied) — the existing
      // style-level total is always exactly right, just composed from
      // several finer-grained ledger rows instead of one. A zero-variant
      // style's flat-only path below is completely unchanged.
      if (!activeVariantsByProduct.get(item.productId)) {
        await recordInventoryTransaction(tx, actor, {
          productId: item.productId,
          warehouseId: dispatch.warehouseId,
          transactionType: "DISPATCH",
          quantity: -item.dispatchedQuantity,
          referenceModule: "DISPATCH",
          referenceRecordId: item.id,
        });
      } else {
        for (const line of item.pickLines) {
          const lineQuantity = Number(line.quantity);
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: dispatch.warehouseId,
            transactionType: "DISPATCH",
            quantity: -lineQuantity,
            referenceModule: "DISPATCH",
            referenceRecordId: item.id,
            productVariantId: line.productVariantId,
            warehouseLocationId: line.warehouseLocationId,
            stockStatus: "SALEABLE",
          });

          // §7 point 5 — reservation consumption happens in the same
          // transaction, immediately after each pick line posts.
          await consumeReservationForDispatchInTx(
            tx,
            actor.companyId,
            item.salesOrderItem.salesOrderLineId,
            line.productVariantId,
            lineQuantity
          );
        }
      }
    }

    const allItems = await tx.salesOrderItem.findMany({
      where: { salesOrderId: dispatch.salesOrderId },
      select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
    });
    // Regular-only, per the spec's own invariant — Extra never inflates
    // Sale Order fulfillment.
    const allFullyDispatched = allItems.every(
      (i) => i.regularDispatchedQuantity >= i.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0)
    );
    await tx.salesOrder.update({
      where: { id: dispatch.salesOrderId },
      data: { status: allFullyDispatched ? "DISPATCHED" : "PARTIALLY_DISPATCHED" },
    });

    const { count } = await tx.dispatch.updateMany({
      where: { id, status: "PACKED" },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch is no longer in Packed status.", {});
    }

    // Transition all individual ProductUnits associated with this dispatch to DISPATCHED
    if (tx.productUnit) {
      const packedUnits = await tx.productUnit.findMany({
        where: { dispatchId: id, status: { not: "DISPATCHED" } },
        select: { id: true, status: true },
      });

      if (packedUnits.length > 0) {
        await tx.productUnit.updateMany({
          where: { id: { in: packedUnits.map((u) => u.id) } },
          data: { status: "DISPATCHED" },
        });

        if (tx.productUnitEvent) {
          await tx.productUnitEvent.createMany({
            data: packedUnits.map((u) => ({
              productUnitId: u.id,
              eventType: "DISPATCHED",
              fromStatus: u.status,
              toStatus: "DISPATCHED",
              referenceType: "DISPATCH",
              referenceId: id,
              remarks: `Confirmed shipment under Dispatch ${dispatch.dispatchNumber}`,
              actorUserId: actor.userId,
            })),
          });
        }
      }
    }
  });

  const updated = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "POST",
    oldValues: { status: "PACKED" },
    newValues: {
      status: "DISPATCHED",
      // Extra Dispatch Quantity auditability (2026-09-30) — who confirmed
      // it, when (the audit log's own existing timestamp/actor columns), and
      // whether this shipment included Extra quantity requiring a distinct
      // approval sign-off, reusing the existing Audit Log system rather than
      // adding new Dispatch columns purely to record who/when approved.
      totalRegularQuantity: totalRegular,
      totalExtraQuantity: totalExtra,
      ...(totalExtra > 0 ? { extraDispatchApprovalRequired: needsApproval, approvedByUserId: actor.userId } : {}),
    },
  });

  return updated;
}

/** DISPATCHED -> DELIVERED. No ledger impact, no SalesOrder.status change —
 * DISPATCHED is the terminal tracked state on the order; "delivered" is a
 * Dispatch-level fact only. */
export async function markDelivered(actor: ActorContext, id: string, receivedByName: string | undefined) {
  const existing = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  const { count } = await DispatchRepository.updateStatusConditional(id, "DISPATCHED", {
    status: "DELIVERED",
    deliveredAt: new Date(),
    receivedByName: receivedByName || null,
  });
  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot mark a dispatch in "${existing.status}" status as delivered — it must be Dispatched first.`,
      { currentStatus: existing.status }
    );
  }

  const updated = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "DISPATCHED" },
    newValues: { status: "DELIVERED" },
  });

  return updated;
}

export async function transitionDispatchStatus(actor: ActorContext, id: string, targetStatus: "ON_HOLD" | "CANCELLED") {
  const before = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a dispatch from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  // Independent, unconditional guard — never inferred from the status label
  // or transition path alone (the exact bug class this project has hit
  // twice: Sampling's Hold/Resume bug, Purchasing's cancel-from-ON_HOLD
  // bug). A Dispatch that has ever posted to the ledger (dispatchedAt set)
  // can never be cancelled, regardless of which status label got it here.
  if (targetStatus === "CANCELLED" && before.dispatchedAt) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Cannot cancel a dispatch that has already been confirmed — its stock impact is a posted fact.",
      { dispatchedAt: before.dispatchedAt }
    );
  }

  const data: Prisma.DispatchUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") {
    data.statusBeforeHold = before.status;
  }

  const { count } = await DispatchRepository.updateStatusConditional(id, before.status, data);
  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a dispatch from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }
  const updated = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

/** Restores the exact status the dispatch was held from — no caller-chosen
 * target, same reasoning as Sampling's/Sales Order's own resume-from-hold. */
export async function resumeDispatchFromHold(actor: ActorContext, id: string) {
  const before = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch isn't on hold.", {
      currentStatus: before.status,
    });
  }

  const { count } = await DispatchRepository.updateStatusConditional(id, "ON_HOLD", {
    status: before.statusBeforeHold,
    statusBeforeHold: null,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch isn't on hold.", {
      currentStatus: before.status,
    });
  }
  const updated = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}

export interface ReverseDispatchInput {
  reason: string;
}

/**
 * Reverses a confirmed (DISPATCHED or DELIVERED) dispatch atomically.
 * Restores Finished Goods inventory balances (StockBalance & FinishedGoodsStockBalance),
 * decrements SalesOrderItem fulfillment counters (regularDispatchedQuantity & dispatchedQuantity),
 * recalculates and rolls back SalesOrder status,
 * and marks the dispatch as REVERSED.
 *
 * Blocked if any active (POSTED / PARTIALLY_PAID / PAID) sales invoices exist for this order.
 */
export async function reverseDispatch(actor: ActorContext, id: string, input: ReverseDispatchInput) {
  const dispatch = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!dispatch) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await PermissionService.assert(actor.userId, "dispatch", "cancel", { createdBy: dispatch.requestedByUserId });

  if (dispatch.status !== "DISPATCHED" && dispatch.status !== "DELIVERED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot reverse a dispatch in "${dispatch.status}" status — only Dispatched or Delivered dispatches can be reversed.`,
      { currentStatus: dispatch.status }
    );
  }

  if (!dispatch.dispatchedAt) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot reverse a dispatch that was never confirmed.", { id });
  }

  const reason = input?.reason?.trim();
  if (!reason) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A reason is required to reverse a confirmed dispatch.", {});
  }

  // A partial customer return already put some pieces back; reversing the
  // whole dispatch now would return them a second time.
  if ((dispatch.returns?.length ?? 0) > 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Some goods on this dispatch were already returned — use Customer Return for the remaining pieces.",
      { returns: dispatch.returns.map((r) => r.returnNumber) }
    );
  }

  const uniqueProductIds = [...new Set(dispatch.items.map((i) => i.productId))];
  const activeVariantsByProduct = new Map<string, boolean>(
    await Promise.all(
      uniqueProductIds.map(async (productId) => [productId, (await ProductVariantRepository.findManyActiveByProductId(productId)).length > 0] as const)
    )
  );

  await prisma.$transaction(async (tx) => {
    // 1. Guard against posted/active invoices on this sales order
    const activeInvoices = await tx.salesInvoice.findMany({
      where: {
        companyId: actor.companyId,
        salesOrderId: dispatch.salesOrderId,
        status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
      },
      select: { invoiceNumber: true },
    });
    if (activeInvoices.length > 0) {
      throw new BusinessRuleError(
        "ACTIVE_INVOICE_EXISTS",
        `Cannot reverse dispatch "${dispatch.dispatchNumber}" because active sales invoice(s) exist for this order (${activeInvoices.map((i) => i.invoiceNumber).join(", ")}). Reverse or cancel the invoices first.`,
        { invoiceNumbers: activeInvoices.map((i) => i.invoiceNumber) }
      );
    }

    // 2. Decrement SalesOrderItem fulfillment counters & restore FG inventory
    for (const item of dispatch.items) {
      const { count } = await tx.salesOrderItem.updateMany({
        where: {
          id: item.salesOrderItem.id,
          regularDispatchedQuantity: { gte: item.regularDispatchQuantity },
          dispatchedQuantity: { gte: item.dispatchedQuantity },
        },
        data: {
          regularDispatchedQuantity: { decrement: item.regularDispatchQuantity },
          dispatchedQuantity: { decrement: item.dispatchedQuantity },
        },
      });
      if (count === 0) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Cannot reverse ${item.dispatchedQuantity} for "${item.product.styleName}" — dispatched quantity would become negative.`,
          { salesOrderItemId: item.salesOrderItem.id }
        );
      }

      if (!activeVariantsByProduct.get(item.productId)) {
        await recordInventoryTransaction(tx, actor, {
          productId: item.productId,
          warehouseId: dispatch.warehouseId,
          transactionType: "DISPATCH_REVERSAL",
          quantity: item.dispatchedQuantity,
          referenceModule: "DISPATCH",
          referenceRecordId: item.id,
          notes: `Reversal of dispatch ${dispatch.dispatchNumber}: ${reason}`,
        });
      } else {
        for (const line of item.pickLines) {
          const lineQuantity = Number(line.quantity);
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: dispatch.warehouseId,
            transactionType: "DISPATCH_REVERSAL",
            quantity: lineQuantity,
            referenceModule: "DISPATCH",
            referenceRecordId: item.id,
            productVariantId: line.productVariantId,
            warehouseLocationId: line.warehouseLocationId,
            stockStatus: "SALEABLE",
            notes: `Reversal of dispatch ${dispatch.dispatchNumber}: ${reason}`,
          });
        }
      }
    }

    // 3. Rollback SalesOrder status
    const allItems = await tx.salesOrderItem.findMany({
      where: { salesOrderId: dispatch.salesOrderId },
      select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
    });
    const totalRegularDispatched = allItems.reduce((sum, i) => sum + i.regularDispatchedQuantity, 0);
    const allFullyDispatched = allItems.every(
      (i) => i.regularDispatchedQuantity >= i.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0)
    );

    let targetSoStatus: "CONFIRMED" | "PARTIALLY_DISPATCHED" | "DISPATCHED";
    if (totalRegularDispatched === 0) {
      targetSoStatus = "CONFIRMED";
    } else if (allFullyDispatched) {
      targetSoStatus = "DISPATCHED";
    } else {
      targetSoStatus = "PARTIALLY_DISPATCHED";
    }

    await tx.salesOrder.update({
      where: { id: dispatch.salesOrderId },
      data: { status: targetSoStatus },
    });

    // 4. Update dispatch status to REVERSED
    const { count } = await tx.dispatch.updateMany({
      where: { id, status: dispatch.status },
      data: { status: "REVERSED" },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Dispatch status changed during reversal.", {});
    }
  });

  const updated = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: dispatch.status },
    newValues: {
      status: "REVERSED",
      reason,
      reversedByUserId: actor.userId,
    },
  });

  return updated;
}


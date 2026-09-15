import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import { MaterialRequestItemRepository } from "@/modules/inventory/material-request.repository";
import { FabricRollRepository } from "./fabric-roll.repository";
import { GoodsReceiptItemRepository, GoodsReceiptRepository } from "./goods-receipt.repository";
import type { GoodsReceiptInput, ReverseGoodsReceiptLineInput } from "./goods-receipt.schema";
import { PurchaseOrderItemRepository, PurchaseOrderRepository } from "./purchase-order.repository";
import type { Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

export async function listGoodsReceipts(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.GoodsReceiptWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { receiptNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    GoodsReceiptRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    GoodsReceiptRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for a receipt outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getGoodsReceiptById(actor: { companyId: string; userId: string }, id: string) {
  const receipt = await GoodsReceiptRepository.findByIdWithDetails(actor.companyId, id);
  if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Goods receipt not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!receipt.branchId || !allowedBranchIds.has(receipt.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Goods receipt not found.", { id });
  }

  return receipt;
}

export interface MaterialRateHistoryEntry {
  // The GoodsReceiptItem's own id — the real unique identity of one row
  // here. purchaseOrderItemId is NOT unique across entries: the same PO
  // line can legitimately be received across more than one Goods Receipt
  // (e.g. two partial receipts), which would collide as a React list key.
  id: string;
  purchaseOrderItemId: string;
  unitPrice: number;
  receivedDate: string;
  receiptNumber: string;
  orderNumber: string;
  supplierName: string;
}

export interface MaterialRateHistoryResult {
  history: MaterialRateHistoryEntry[];
  fallbackUnitCost: number | null;
}

/**
 * Real purchase-rate history for a material, anchored on Goods Receipt (not
 * just Purchase Order creation) — a PO can be raised and never actually
 * arrive, so "how many times has this material come into stock" is a
 * GoodsReceiptItem question, not a PurchaseOrderItem one. Each receipt line
 * carries its own commercial rate via the PurchaseOrderItem it was received
 * against. Scoped by colorId/dyeId when the caller supplies them (a Sample
 * Material line pinned to one shade shouldn't be suggested a rate paid for a
 * different one) — same shade-matters reasoning already applied to
 * available-stock-by-dye. A cancelled receipt is excluded (never a real
 * transaction); most-recent-received first, so a stale rate from years ago
 * doesn't outrank what was actually paid last time.
 *
 * `fallbackUnitCost` is the Material master's own manually-maintained
 * default (Product.unitCost) — a different, non-history source, surfaced
 * only for the case with zero real purchase history to suggest from at all.
 */
export async function getMaterialRateHistory(
  companyId: string,
  materialId: string,
  colorId?: string | null,
  dyeId?: string | null
): Promise<MaterialRateHistoryResult> {
  const [receiptItems, material] = await Promise.all([
    prisma.goodsReceiptItem.findMany({
      where: {
        productId: materialId,
        goodsReceipt: { companyId, status: { not: "CANCELLED" } },
        purchaseOrderItem: {
          ...(colorId ? { colorId } : {}),
          ...(dyeId ? { dyeId } : {}),
        },
      },
      select: {
        id: true,
        goodsReceipt: { select: { receiptNumber: true, receivedDate: true } },
        purchaseOrderItem: {
          select: {
            id: true,
            unitPrice: true,
            purchaseOrder: { select: { orderNumber: true, supplier: { select: { name: true } } } },
          },
        },
      },
      orderBy: { goodsReceipt: { receivedDate: "desc" } },
    }),
    prisma.product.findFirst({ where: { id: materialId, companyId }, select: { unitCost: true } }),
  ]);

  const history: MaterialRateHistoryEntry[] = receiptItems.map((item) => ({
    id: item.id,
    purchaseOrderItemId: item.purchaseOrderItem.id,
    unitPrice: Number(item.purchaseOrderItem.unitPrice),
    receivedDate: item.goodsReceipt.receivedDate.toISOString(),
    receiptNumber: item.goodsReceipt.receiptNumber,
    orderNumber: item.purchaseOrderItem.purchaseOrder.orderNumber,
    supplierName: item.purchaseOrderItem.purchaseOrder.supplier.name,
  }));

  return {
    history,
    fallbackUnitCost: material?.unitCost === null || material?.unitCost === undefined ? null : Number(material.unitCost),
  };
}

/**
 * Deliberately opens its own prisma.$transaction here rather than pushing it
 * into a single repository function — this orchestration spans PurchaseOrderItem,
 * GoodsReceipt/GoodsReceiptItem/FabricRoll, and the shared Inventory ledger
 * engine (a different module), and no single repository owns all of them.
 * Every actual write still goes through a repository function that accepts
 * the `tx` client — this function only sequences them.
 */
export async function createGoodsReceipt(actor: ActorContext, purchaseOrderId: string, input: GoodsReceiptInput) {
  // CF-5: a network retry or double-click resubmitting the identical create
  // call must return the ORIGINAL receipt, not create and post a second one
  // — checked before anything else (including drawing a document number, so
  // a replay doesn't burn a real sequence value either). Only takes effect
  // when the caller actually supplies a key; a caller that doesn't gets the
  // prior, unprotected behavior unchanged.
  if (input.idempotencyKey) {
    const existing = await GoodsReceiptRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const po = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, purchaseOrderId);
  if (!po) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id: purchaseOrderId });

  if (po.status !== "SENT_TO_SUPPLIER" && po.status !== "PARTIALLY_RECEIVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot receive goods against a purchase order in "${po.status}" status.`,
      { currentStatus: po.status }
    );
  }

  const itemsById = new Map(po.items.map((item) => [item.id, item]));

  for (const inputItem of input.items) {
    const poItem = itemsById.get(inputItem.purchaseOrderItemId);
    if (!poItem) {
      throw new BusinessRuleError("NOT_FOUND", "Purchase order line not found on this order.", {
        id: inputItem.purchaseOrderItemId,
      });
    }

    const rollQuantitySum = inputItem.rolls.reduce((sum, roll) => sum + roll.rollQuantity, 0);
    if (inputItem.rolls.length > 0 && Math.abs(rollQuantitySum - inputItem.receivedQuantity) > 0.0001) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Roll quantities (${rollQuantitySum}) must add up to the line's received quantity (${inputItem.receivedQuantity}).`,
        { purchaseOrderItemId: inputItem.purchaseOrderItemId }
      );
    }

    // A fabric line received with zero rolls would silently skip the entire
    // feature this module exists for — required, not just nudged.
    if (poItem.product.materialCategory === "FABRIC" && inputItem.rolls.length === 0) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${poItem.product.styleName}" is a fabric material — at least one roll must be recorded for this line.`,
        { purchaseOrderItemId: inputItem.purchaseOrderItemId }
      );
    }
  }

  // Convert to the material's base UOM up front (pure computation, no writes
  // yet) — GoodsReceiptItem.receivedQuantity itself stays in the PO line's
  // original unit (the commercial document, compared against
  // PurchaseOrderItem.orderedQuantity in that same unit), but FabricRoll's
  // own quantities and every ledger write must speak the material's base
  // UOM consistently, or "remaining roll quantity" and "stock balance" would
  // visibly disagree for a material whose PO line used a different unit.
  const baseUomLineQuantityByPoItemId = new Map<string, number>();
  const baseUomRollQuantities = new Map<string, number[]>();

  for (const inputItem of input.items) {
    const poItem = itemsById.get(inputItem.purchaseOrderItemId)!;
    if (!poItem.product.baseUom) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${poItem.product.styleName}" has no base unit configured — cannot record stock for it.`,
        { purchaseOrderItemId: poItem.id }
      );
    }

    const lineBase = convertUomQuantity(inputItem.receivedQuantity, poItem.uom, poItem.product.baseUom);
    if (lineBase === null) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${poItem.uom.name}" has no fixed conversion to "${poItem.product.styleName}"'s base unit.`,
        { purchaseOrderItemId: poItem.id }
      );
    }
    baseUomLineQuantityByPoItemId.set(inputItem.purchaseOrderItemId, lineBase);

    const rollBaseQuantities = inputItem.rolls.map((roll) => {
      const rollBase = convertUomQuantity(roll.rollQuantity, poItem.uom, poItem.product.baseUom!);
      if (rollBase === null) {
        throw new BusinessRuleError(
          "UOM_CONVERSION_UNAVAILABLE",
          `"${poItem.uom.name}" has no fixed conversion to "${poItem.product.styleName}"'s base unit.`,
          { purchaseOrderItemId: poItem.id }
        );
      }
      return rollBase;
    });
    baseUomRollQuantities.set(inputItem.purchaseOrderItemId, rollBaseQuantities);
  }

  const receiptNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "GOODS_RECEIPT",
  });

  let receipt;
  try {
    receipt = await prisma.$transaction(async (tx) => {
      // No over-receipt block — the person entering the receipt records
      // whatever actually physically arrived, whether that's short of or
      // beyond the ordered quantity (a real, common warehouse scenario, not
      // a data-entry mistake to reject). The atomic increment itself is
      // still the accumulator's only writer, just with no upper-bound
      // condition left to enforce.
      for (const inputItem of input.items) {
        const poItem = itemsById.get(inputItem.purchaseOrderItemId)!;
        const result = await PurchaseOrderItemRepository.incrementReceived(tx, poItem.id, inputItem.receivedQuantity);
        if (result.count === 0) {
          throw new BusinessRuleError("NOT_FOUND", `Purchase order line "${poItem.product.styleName}" no longer exists.`, {
            purchaseOrderItemId: poItem.id,
          });
        }
      }

      const created = await GoodsReceiptRepository.createWithItemsAndRolls(tx, {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        receiptNumber,
        purchaseOrderId,
        receivedDate: new Date(input.receivedDate),
        receivedByUserId: actor.userId,
        status: "COMPLETED",
        idempotencyKey: input.idempotencyKey ?? null,
        items: {
          create: input.items.map((item) => {
            const poItem = itemsById.get(item.purchaseOrderItemId)!;
            return {
              purchaseOrderItemId: item.purchaseOrderItemId,
              productId: poItem.productId,
              uomId: poItem.uomId,
              receivedQuantity: item.receivedQuantity,
              warehouseId: item.warehouseId,
              warehouseLocationId: item.warehouseLocationId || null,
              notes: item.notes || null,
              rolls: {
                create: item.rolls.map((roll, rollIndex) => {
                  // Stored in the material's base UOM, not the roll's
                  // as-entered unit — see the conversion pass above.
                  const baseQuantity = baseUomRollQuantities.get(item.purchaseOrderItemId)![rollIndex];
                  return {
                    companyId: actor.companyId,
                    rollNumber: roll.rollNumber,
                    rollQuantity: baseQuantity,
                    remainingQuantity: baseQuantity,
                    batchNo: roll.batchNo || null,
                    gsmId: roll.gsmId || null,
                    dyeId: roll.dyeId || null,
                    weaveTypeId: roll.weaveTypeId || null,
                    widthId: roll.widthId || null,
                    compositionId: roll.compositionId || null,
                    warehouseLocationId: roll.warehouseLocationId || item.warehouseLocationId || null,
                    status: "IN_STOCK",
                  };
                }),
              },
            };
          }),
        },
      });

      // Ledger granularity mirrors physical rolls when present — one
      // InventoryTransaction per roll, not one aggregate row per line. Roll
      // quantities are already base-UOM (stored that way above); the
      // non-roll line quantity uses the precomputed base-UOM conversion since
      // createdItem.receivedQuantity itself is still in the original unit.
      for (const createdItem of created.items) {
        if (createdItem.rolls.length > 0) {
          for (const roll of createdItem.rolls) {
            await recordInventoryTransaction(tx, actor, {
              productId: createdItem.productId,
              warehouseId: createdItem.warehouseId,
              warehouseLocationId: createdItem.warehouseLocationId,
              transactionType: "GOODS_RECEIPT",
              quantity: Number(roll.rollQuantity),
              referenceModule: "GOODS_RECEIPT",
              referenceRecordId: createdItem.id,
              fabricRollId: roll.id,
            });
          }
        } else {
          await recordInventoryTransaction(tx, actor, {
            productId: createdItem.productId,
            warehouseId: createdItem.warehouseId,
            warehouseLocationId: createdItem.warehouseLocationId,
            transactionType: "GOODS_RECEIPT",
            quantity: baseUomLineQuantityByPoItemId.get(createdItem.purchaseOrderItemId)!,
            referenceModule: "GOODS_RECEIPT",
            referenceRecordId: createdItem.id,
          });
        }

        // Material Request rollup — purely a secondary traceability mirror,
        // never a reason to block a legitimate goods receipt. Fails soft: a
        // missing/unconvertible unit, a lost concurrency race, or the line
        // genuinely over-receiving past what was ordered (this rollup's own
        // cap is still the sum of ordered quantities, deliberately left
        // as-is — see incrementReceived's own comment for why the real,
        // unrelated PO-item accumulator has no such cap any more) just skips
        // the rollup for this line without affecting the receipt itself.
        const poItem = itemsById.get(createdItem.purchaseOrderItemId)!;
        if (poItem.materialRequestItemId) {
          const mrLine = await MaterialRequestItemRepository.findForReceiptRollupInTx(tx, poItem.materialRequestItemId);
          if (mrLine) {
            const convertedToMrUnit = convertUomQuantity(Number(createdItem.receivedQuantity), poItem.uom, mrLine.uom);
            if (convertedToMrUnit !== null) {
              const cap = mrLine.purchaseOrderItems.reduce((sum, p) => sum + Number(p.orderedQuantity), 0);
              await MaterialRequestItemRepository.guardedIncrementPurchaseReceived(tx, mrLine.id, cap, convertedToMrUnit);
            }
          }
        }
      }

      const allItems = await PurchaseOrderItemRepository.findManyForStatusRecompute(tx, purchaseOrderId);
      const allFullyReceived = allItems.every((i) => Number(i.receivedQuantity) >= Number(i.orderedQuantity));
      await PurchaseOrderRepository.updateStatusInTx(tx, purchaseOrderId, {
        status: allFullyReceived ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED",
      });

      return created;
    });
  } catch (err) {
    // A genuine concurrent replay: two requests carrying the identical
    // idempotencyKey both passed the pre-transaction check above before
    // either committed. The @@unique constraint is what actually prevents
    // the duplicate; this just makes the loser of that race transparently
    // return the winner's receipt instead of surfacing a raw conflict.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await GoodsReceiptRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "goods_receipts",
    recordId: receipt.id,
    action: "CREATE",
    newValues: { receiptNumber: receipt.receiptNumber, purchaseOrderId },
  });

  return receipt;
}

/**
 * The actual "goods-receipt returns" pattern CLAUDE.md's Domain Reference
 * calls for — per-line, capped, reversal-only. The physical "send it back to
 * the supplier for a credit" workflow stays explicitly deferred; this is
 * just the correction primitive underneath it (a data-entry mistake, a
 * damaged roll discovered after receiving, etc.).
 */
export async function reverseGoodsReceiptLine(
  actor: ActorContext,
  goodsReceiptItemId: string,
  input: ReverseGoodsReceiptLineInput
) {
  const item = await GoodsReceiptItemRepository.findByIdWithContext(actor.companyId, goodsReceiptItemId);
  if (!item) throw new BusinessRuleError("NOT_FOUND", "Goods receipt line not found.", { id: goodsReceiptItemId });

  if (item.goodsReceipt.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This goods receipt has already been fully reversed.", {
      goodsReceiptId: item.goodsReceiptId,
    });
  }

  const fabricRollId = input.fabricRollId || undefined;
  const hasRolls = item.rolls.length > 0;

  if (hasRolls && !fabricRollId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This line is roll-tracked — pick which roll the reversal applies to.",
      { goodsReceiptItemId }
    );
  }
  if (!hasRolls && fabricRollId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This line has no rolls to reverse against.", { goodsReceiptItemId });
  }

  const targetRoll = fabricRollId ? item.rolls.find((r) => r.id === fabricRollId) : undefined;
  if (fabricRollId && !targetRoll) {
    throw new BusinessRuleError("NOT_FOUND", "That roll does not belong to this line.", { id: fabricRollId });
  }

  // A roll-scoped reversal quantity is entered against remainingQuantity,
  // which is already base-UOM (see createGoodsReceipt) — no conversion.
  // A line-scoped reversal quantity is entered against the line's own
  // un-reversed remainder, which stays in the PO line's original unit — it
  // must be converted before it can cancel out the ledger/StockBalance
  // entry that createGoodsReceipt wrote in base UOM.
  let ledgerQuantity: number;
  if (targetRoll) {
    ledgerQuantity = input.quantity;
  } else {
    if (!item.product.baseUom) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${item.product.styleName}" has no base unit configured.`,
        { goodsReceiptItemId }
      );
    }
    const converted = convertUomQuantity(input.quantity, item.uom, item.product.baseUom);
    if (converted === null) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${item.uom.name}" has no fixed conversion to "${item.product.styleName}"'s base unit.`,
        { goodsReceiptItemId }
      );
    }
    ledgerQuantity = converted;
  }

  const result = await prisma.$transaction(async (tx) => {
    if (targetRoll) {
      const rollUpdate = await FabricRollRepository.guardedDecrementRemaining(tx, targetRoll.id, input.quantity);
      if (rollUpdate.count === 0) {
        throw new BusinessRuleError(
          "OVER_REVERSAL_NOT_ALLOWED",
          `Cannot reverse ${input.quantity} — more than this roll's remaining quantity.`,
          { fabricRollId: targetRoll.id }
        );
      }
      const afterRoll = await FabricRollRepository.findRemainingInTx(tx, targetRoll.id);
      if (afterRoll && Number(afterRoll.remainingQuantity) <= 0) {
        await FabricRollRepository.updateStatusInTx(tx, targetRoll.id, "CANCELLED");
      }
    }

    const lineUpdate = await GoodsReceiptItemRepository.guardedIncrementReversed(
      tx,
      goodsReceiptItemId,
      Number(item.receivedQuantity),
      input.quantity
    );
    if (lineUpdate.count === 0) {
      throw new BusinessRuleError(
        "OVER_REVERSAL_NOT_ALLOWED",
        `Cannot reverse ${input.quantity} — more than this line's remaining un-reversed quantity.`,
        { goodsReceiptItemId }
      );
    }

    await recordInventoryTransaction(tx, actor, {
      productId: item.productId,
      warehouseId: item.warehouseId,
      warehouseLocationId: item.warehouseLocationId,
      transactionType: "GOODS_RECEIPT_REVERSAL",
      quantity: -ledgerQuantity,
      referenceModule: "GOODS_RECEIPT",
      referenceRecordId: goodsReceiptItemId,
      fabricRollId: targetRoll?.id || null,
      notes: input.reason,
    });

    const decrementResult = await PurchaseOrderItemRepository.guardedDecrementReceived(
      tx,
      item.purchaseOrderItemId,
      input.quantity
    );
    if (decrementResult === 0) {
      throw new BusinessRuleError(
        "OVER_REVERSAL_NOT_ALLOWED",
        `Cannot reverse ${input.quantity} — ${item.purchaseOrderItem.invoicedQuantity} of this line has already been invoiced and can't be left unreceived.`,
        { purchaseOrderItemId: item.purchaseOrderItemId }
      );
    }

    // Symmetric to the rollup in createGoodsReceipt() — same fail-soft
    // philosophy, never blocks the reversal itself.
    if (item.purchaseOrderItem.materialRequestItemId && item.purchaseOrderItem.materialRequestItem) {
      const mrLine = item.purchaseOrderItem.materialRequestItem;
      const fromUom = targetRoll ? item.product.baseUom : item.uom;
      const convertedToMrUnit = fromUom ? convertUomQuantity(input.quantity, fromUom, mrLine.uom) : null;
      if (convertedToMrUnit !== null) {
        await MaterialRequestItemRepository.decrementPurchaseReceived(tx, mrLine.id, convertedToMrUnit);
      }
    }

    const poItems = await PurchaseOrderItemRepository.findManyForStatusRecompute(
      tx,
      item.purchaseOrderItem.purchaseOrderId
    );
    const allZero = poItems.every((i) => Number(i.receivedQuantity) <= 0);
    const allFullyReceived = poItems.every((i) => Number(i.receivedQuantity) >= Number(i.orderedQuantity));
    await PurchaseOrderRepository.updateStatusInTx(tx, item.purchaseOrderItem.purchaseOrderId, {
      status: allZero ? "SENT_TO_SUPPLIER" : allFullyReceived ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED",
    });

    const receiptItems = await GoodsReceiptItemRepository.findManyByReceiptIdInTx(tx, item.goodsReceiptId);
    const allLinesFullyReversed = receiptItems.every((i) => Number(i.reversedQuantity) >= Number(i.receivedQuantity));
    const anyLinePartiallyReversed = receiptItems.some((i) => Number(i.reversedQuantity) > 0);
    await GoodsReceiptRepository.updateStatusInTx(
      tx,
      item.goodsReceiptId,
      allLinesFullyReversed ? "CANCELLED" : anyLinePartiallyReversed ? "PARTIALLY_REVERSED" : "COMPLETED"
    );

    return { goodsReceiptId: item.goodsReceiptId };
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "goods_receipt_items",
    recordId: goodsReceiptItemId,
    action: "CANCEL",
    oldValues: { reversedQuantity: item.reversedQuantity },
    newValues: { reversedQuantityDelta: input.quantity, reason: input.reason, fabricRollId: fabricRollId || null },
  });

  return getGoodsReceiptById(actor, result.goodsReceiptId);
}

/** Thin convenience wrapper: reverses every line's (and, for roll-tracked
 * lines, every roll's) full remaining un-reversed quantity — "cancel the
 * whole receipt" is just "reverse everything on it." */
export async function cancelGoodsReceipt(actor: ActorContext, id: string, reason: string) {
  const receipt = await GoodsReceiptRepository.findByIdWithDetails(actor.companyId, id);
  if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Goods receipt not found.", { id });

  for (const item of receipt.items) {
    const lineRemaining = Number(item.receivedQuantity) - Number(item.reversedQuantity);
    if (lineRemaining <= 0) continue;

    if (item.rolls.length > 0) {
      for (const roll of item.rolls) {
        const rollRemaining = Number(roll.remainingQuantity);
        if (rollRemaining <= 0) continue;
        await reverseGoodsReceiptLine(actor, item.id, { quantity: rollRemaining, reason, fabricRollId: roll.id });
      }
    } else {
      await reverseGoodsReceiptLine(actor, item.id, { quantity: lineRemaining, reason });
    }
  }

  return getGoodsReceiptById(actor, id);
}

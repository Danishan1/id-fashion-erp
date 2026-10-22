import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import type { ReceiveFinishedGoodsInput } from "./finished-goods-receive.schema";

const EPSILON = 0.0001;

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Finished Goods Receive (2026-10-22): every receipt line still waiting to be
 * received — goods packed by Production or sent back by a customer. They are
 * NOT in Finished Goods stock until received here.
 */
export async function listPendingReceiptLines(actor: { companyId: string }, filters: { warehouseId?: string } = {}) {
  const items = await prisma.finishedGoodsReceiptItem.findMany({
    where: {
      finishedGoodsReceipt: {
        companyId: actor.companyId,
        status: { in: ["PENDING", "PARTIALLY_RECEIVED"] },
        ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
      },
    },
    include: {
      productVariant: { include: { color: true, size: true } },
      finishedGoodsReceipt: {
        select: {
          id: true,
          receiptNumber: true,
          source: true,
          postedAt: true,
          remarks: true,
          warehouseId: true,
          warehouse: { select: { id: true, name: true } },
          product: { select: { id: true, styleCode: true, styleName: true } },
          lot: { select: { id: true, lotNumber: true } },
          productionOrder: { select: { id: true, orderNumber: true } },
          dispatch: { select: { id: true, dispatchNumber: true } },
          dispatchReturn: { select: { id: true, returnNumber: true } },
        },
      },
    },
    orderBy: [{ finishedGoodsReceipt: { postedAt: "asc" } }],
  });
  return items
    .map((item) => ({ ...item, pendingQuantity: Number(item.quantity) - Number(item.receivedQuantity) }))
    .filter((item) => item.pendingQuantity > EPSILON);
}

async function receiveOneLine(actor: ActorContext, line: ReceiveFinishedGoodsInput["lines"][number]) {
  return prisma.$transaction(async (tx) => {
    // Lock the line so two people can't receive the same pieces twice.
    await tx.$queryRaw`SELECT id FROM finished_goods_receipt_items WHERE id = ${line.receiptItemId}::uuid FOR UPDATE`;
    const item = await tx.finishedGoodsReceiptItem.findUnique({
      where: { id: line.receiptItemId },
      include: { finishedGoodsReceipt: true },
    });
    const receipt = item?.finishedGoodsReceipt;
    if (!item || !receipt || receipt.companyId !== actor.companyId) {
      throw new BusinessRuleError("NOT_FOUND", "Receipt line not found.", { id: line.receiptItemId });
    }
    if (receipt.status === "RECEIVED") {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", `${receipt.receiptNumber} is already fully received.`, {});
    }
    const pending = Number(item.quantity) - Number(item.receivedQuantity);
    if (line.quantity > pending + EPSILON) {
      throw new BusinessRuleError(
        "OVER_RECEIPT_NOT_ALLOWED",
        `Only ${pending} pcs are still waiting to be received on ${receipt.receiptNumber}.`,
        { pending, requested: line.quantity }
      );
    }

    // The location must be a real, active location of the receipt's own
    // warehouse; it is required whenever that warehouse has locations.
    const locationId = line.warehouseLocationId || null;
    if (locationId) {
      const location = await tx.warehouseLocation.findFirst({
        where: { id: locationId, warehouseId: receipt.warehouseId, warehouse: { companyId: actor.companyId } },
        select: { id: true, isActive: true },
      });
      if (!location) {
        throw new BusinessRuleError("VALIDATION_ERROR", "Choose a location of the warehouse these goods arrived at.", { locationId });
      }
      if (!location.isActive) throw new BusinessRuleError("VALIDATION_ERROR", "That location is inactive.", { locationId });
    } else {
      const locationCount = await tx.warehouseLocation.count({ where: { warehouseId: receipt.warehouseId, isActive: true } });
      if (locationCount > 0) {
        throw new BusinessRuleError("VALIDATION_ERROR", `Choose the location to put ${receipt.receiptNumber} into.`, {});
      }
    }

    const fromProduction = receipt.source === "PRODUCTION";
    const ledgerRow = await recordInventoryTransaction(tx, actor, {
      productId: receipt.productId,
      warehouseId: receipt.warehouseId,
      transactionType: fromProduction ? "PRODUCTION_RECEIPT" : "CUSTOMER_RETURN",
      quantity: line.quantity,
      // Production keeps its lot reference (contributing-lot reports read it).
      referenceModule: fromProduction && receipt.lotId ? "PRODUCTION_ORDER" : "FINISHED_GOODS_RECEIPT",
      referenceRecordId: fromProduction && receipt.lotId ? receipt.lotId : receipt.id,
      ...(item.productVariantId
        ? { productVariantId: item.productVariantId, warehouseLocationId: locationId, stockStatus: "SALEABLE" as const }
        : {}),
      notes: `Received ${receipt.receiptNumber}${line.remarks ? `: ${line.remarks}` : ""}`,
    });

    await tx.finishedGoodsReceiptItem.update({
      where: { id: item.id },
      data: { receivedQuantity: { increment: line.quantity } },
    });
    await tx.finishedGoodsReceiptPosting.create({
      data: {
        finishedGoodsReceiptId: receipt.id,
        receiptItemId: item.id,
        quantity: line.quantity,
        warehouseLocationId: locationId,
        inventoryTransactionId: ledgerRow.id,
        receivedByUserId: actor.userId,
        remarks: line.remarks?.trim() || null,
      },
    });

    const lines = await tx.finishedGoodsReceiptItem.findMany({
      where: { finishedGoodsReceiptId: receipt.id },
      select: { quantity: true, receivedQuantity: true },
    });
    const allIn = lines.every((l) => Number(l.receivedQuantity) + EPSILON >= Number(l.quantity));
    const status = allIn ? "RECEIVED" : "PARTIALLY_RECEIVED";
    await tx.finishedGoodsReceipt.update({
      where: { id: receipt.id },
      data: { status, ...(allIn ? { receivedAt: new Date() } : {}) },
    });
    return { receipt, status };
  });
}

/**
 * Receives one or more pending lines into stock. Each line is its own
 * transaction (one bad line never blocks the rest) and writes a receive-log
 * row, a ledger row and an audit entry; the result says which lines failed.
 */
export async function receiveFinishedGoods(actor: ActorContext, input: ReceiveFinishedGoodsInput) {
  const results: Array<{ index: number; ok: boolean; error?: string }> = [];
  for (const [index, line] of input.lines.entries()) {
    try {
      const { receipt, status } = await receiveOneLine(actor, line);
      results.push({ index, ok: true });
      await writeAuditLog({
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: "finished_goods_receipts",
        recordId: receipt.id,
        action: "UPDATE",
        newValues: {
          receiptNumber: receipt.receiptNumber,
          receiptItemId: line.receiptItemId,
          receivedQuantity: line.quantity,
          warehouseLocationId: line.warehouseLocationId || null,
          status,
        },
      });
    } catch (error) {
      results.push({ index, ok: false, error: error instanceof BusinessRuleError ? error.message : "Could not receive this line." });
    }
  }
  return { received: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

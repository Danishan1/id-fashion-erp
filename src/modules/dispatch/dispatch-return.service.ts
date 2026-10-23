import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FinishedGoodsReceiptRepository } from "@/modules/finished-goods-inventory/finished-goods-receipt.repository";
import type { Prisma } from "@prisma/client";
import { DispatchRepository } from "./dispatch.repository";
import type { DispatchReturnInput } from "./dispatch.schema";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/** Recomputes the Sales Order status from its lines' regular shipped quantity (same rule reverseDispatch uses). */
export async function recomputeSalesOrderDispatchStatusInTx(tx: Prisma.TransactionClient, salesOrderId: string) {
  const allItems = await tx.salesOrderItem.findMany({
    where: { salesOrderId },
    select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
  });
  const totalRegularDispatched = allItems.reduce((sum, i) => sum + i.regularDispatchedQuantity, 0);
  const allFullyDispatched = allItems.every(
    (i) => i.regularDispatchedQuantity >= i.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0)
  );
  const status = totalRegularDispatched === 0 ? "CONFIRMED" : allFullyDispatched ? "DISPATCHED" : "PARTIALLY_DISPATCHED";
  await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status } });
}

/**
 * Customer return against a confirmed (Dispatched/Delivered) dispatch —
 * whole or partial, with a remark (2026-10-22).
 *
 * Returned pieces do NOT go straight into stock: each style gets a PENDING
 * Finished Goods receipt (source CUSTOMER_RETURN) on the FG Receive page,
 * with the original pick location suggested; stock goes up only when the
 * store receives it there. The Sales Order's shipped quantity goes down by
 * the returned pieces right away.
 * Returned pieces come off the line's Extra Dispatch Quantity first, so the
 * order's own fulfilment drops only for regular pieces. When every shipped
 * piece has come back, the dispatch is marked REVERSED.
 *
 * Like a full reversal, it's blocked while a posted sales invoice exists for
 * the order (the accounts side needs a credit note first).
 */
export async function returnDispatchItems(actor: ActorContext, id: string, input: DispatchReturnInput) {
  const dispatch = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!dispatch) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await PermissionService.assert(actor.userId, "dispatch", "cancel");

  if (dispatch.status !== "DISPATCHED" && dispatch.status !== "DELIVERED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Goods can only be returned from a Dispatched or Delivered dispatch (this one is "${dispatch.status}").`,
      { currentStatus: dispatch.status }
    );
  }

  // Merge repeated lines for the same pick line / dispatch line.
  const merged = new Map<string, { dispatchItemId: string; pickLineId: string | null; quantity: number; remark: string | null }>();
  for (const line of input.lines) {
    const key = `${line.dispatchItemId}:${line.pickLineId ?? "-"}`;
    const existing = merged.get(key);
    const remark = line.remark?.trim() || null;
    if (existing) {
      existing.quantity += line.quantity;
      existing.remark = existing.remark ?? remark;
    } else {
      merged.set(key, { dispatchItemId: line.dispatchItemId, pickLineId: line.pickLineId ?? null, quantity: line.quantity, remark });
    }
  }

  // Numbers come from the dispatch's own branch counter (the same series
  // its production receipts use), never a separate no-branch counter that
  // would repeat numbers already issued there.
  const returnNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: dispatch.branchId ?? null,
    documentType: "CUSTOMER_RETURN",
  });

  const result = await prisma.$transaction(async (tx) => {
    // Serialise returns on this dispatch so two concurrent returns can't both
    // pass the "not more than shipped" check.
    await tx.$queryRaw`SELECT id FROM dispatches WHERE id = ${id}::uuid FOR UPDATE`;

    const activeInvoices = await tx.salesInvoice.findMany({
      where: { companyId: actor.companyId, salesOrderId: dispatch.salesOrderId, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID"] } },
      select: { invoiceNumber: true },
    });
    if (activeInvoices.length > 0) {
      throw new BusinessRuleError(
        "ACTIVE_INVOICE_EXISTS",
        `Cannot take back goods on "${dispatch.dispatchNumber}" because a posted sales invoice exists for this order (${activeInvoices.map((i) => i.invoiceNumber).join(", ")}). Raise a credit note / reverse the invoice first.`,
        { invoiceNumbers: activeInvoices.map((i) => i.invoiceNumber) }
      );
    }

    const priorItems = await tx.dispatchReturnItem.findMany({
      where: { dispatchReturn: { dispatchId: id } },
      select: { dispatchItemId: true, pickLineId: true, quantity: true, regularQuantity: true },
    });
    const returnedByPickLine = new Map<string, number>();
    const returnedByItem = new Map<string, { total: number; regular: number }>();
    for (const p of priorItems) {
      if (p.pickLineId) returnedByPickLine.set(p.pickLineId, (returnedByPickLine.get(p.pickLineId) ?? 0) + p.quantity);
      const t = returnedByItem.get(p.dispatchItemId) ?? { total: 0, regular: 0 };
      t.total += p.quantity;
      t.regular += p.regularQuantity;
      returnedByItem.set(p.dispatchItemId, t);
    }

    const rows: Prisma.DispatchReturnItemCreateManyDispatchReturnInput[] = [];
    let totalQuantity = 0;
    for (const line of merged.values()) {
      const item = dispatch.items.find((i) => i.id === line.dispatchItemId);
      if (!item) throw new BusinessRuleError("NOT_FOUND", "That line is not on this dispatch.", { dispatchItemId: line.dispatchItemId });

      let productVariantId: string | null = null;
      let warehouseLocationId: string | null = null;
      if (item.pickLines.length > 0) {
        const pick = item.pickLines.find((p) => p.id === line.pickLineId);
        if (!pick) {
          throw new BusinessRuleError("VALIDATION_ERROR", `Choose which colour/size of "${item.product.styleName}" is being returned.`, {
            dispatchItemId: item.id,
          });
        }
        const left = Number(pick.quantity) - (returnedByPickLine.get(pick.id) ?? 0);
        if (line.quantity > left) {
          throw new BusinessRuleError(
            "OVER_REVERSAL_NOT_ALLOWED",
            `Only ${left} pcs of "${item.product.styleName}" (${pick.productVariant.color.name} / ${pick.productVariant.size.name}) can still be returned on this dispatch.`,
            { pickLineId: pick.id, returnable: left, requested: line.quantity }
          );
        }
        returnedByPickLine.set(pick.id, (returnedByPickLine.get(pick.id) ?? 0) + line.quantity);
        productVariantId = pick.productVariantId;
        warehouseLocationId = pick.warehouseLocationId;
      } else if (line.pickLineId) {
        throw new BusinessRuleError("VALIDATION_ERROR", "That colour/size was not picked on this dispatch line.", { pickLineId: line.pickLineId });
      }

      const sofar = returnedByItem.get(item.id) ?? { total: 0, regular: 0 };
      const itemLeft = item.dispatchedQuantity - sofar.total;
      if (line.quantity > itemLeft) {
        throw new BusinessRuleError(
          "OVER_REVERSAL_NOT_ALLOWED",
          `Only ${itemLeft} pcs of "${item.product.styleName}" can still be returned on this dispatch.`,
          { dispatchItemId: item.id, returnable: itemLeft, requested: line.quantity }
        );
      }
      // Extra (beyond-order) pieces come back first; only the rest lowers fulfilment.
      const extraLeft = item.extraDispatchQuantity - (sofar.total - sofar.regular);
      const regularQuantity = line.quantity - Math.min(line.quantity, Math.max(0, extraLeft));
      returnedByItem.set(item.id, { total: sofar.total + line.quantity, regular: sofar.regular + regularQuantity });

      const { count } = await tx.salesOrderItem.updateMany({
        where: {
          id: item.salesOrderItem.id,
          dispatchedQuantity: { gte: line.quantity },
          regularDispatchedQuantity: { gte: regularQuantity },
        },
        data: {
          dispatchedQuantity: { decrement: line.quantity },
          regularDispatchedQuantity: { decrement: regularQuantity },
        },
      });
      if (count === 0) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Cannot return ${line.quantity} pcs of "${item.product.styleName}" — the order's shipped quantity would become negative.`,
          { salesOrderItemId: item.salesOrderItem.id }
        );
      }

      rows.push({
        dispatchItemId: item.id,
        pickLineId: line.pickLineId,
        productVariantId,
        warehouseLocationId,
        quantity: line.quantity,
        regularQuantity,
        remark: line.remark,
      });
      totalQuantity += line.quantity;
    }

    const created = await tx.dispatchReturn.create({
      data: {
        companyId: actor.companyId,
        dispatchId: id,
        returnNumber,
        remarks: input.remarks,
        totalQuantity,
        returnedByUserId: actor.userId,
        items: { createMany: { data: rows } },
      },
      include: { items: true },
    });

    // One pending Finished Goods receipt per style, waiting on FG Receive.
    for (const item of dispatch.items) {
      const itemRows = rows.filter((row) => row.dispatchItemId === item.id);
      if (itemRows.length === 0) continue;
      const receiptNumber = await generateDocumentNumber({
        companyId: actor.companyId,
        branchId: dispatch.branchId ?? null,
        documentType: "FG_RECEIPT",
      });
      await FinishedGoodsReceiptRepository.createWithItemsInTx(tx, {
        companyId: actor.companyId,
        branchId: dispatch.branchId ?? null,
        receiptNumber,
        productId: item.productId,
        dispatchId: id,
        dispatchReturnId: created.id,
        warehouseId: dispatch.warehouseId,
        totalQuantity: itemRows.reduce((sum, row) => sum + row.quantity, 0),
        source: "CUSTOMER_RETURN",
        status: "PENDING",
        remarks: `Customer return ${returnNumber} on ${dispatch.dispatchNumber}: ${input.remarks}`,
        postedByUserId: actor.userId,
        items: itemRows.map((row) => ({
          productVariantId: row.productVariantId ?? null,
          quantity: row.quantity,
          suggestedLocationId: row.warehouseLocationId ?? null,
        })),
      });
    }

    await recomputeSalesOrderDispatchStatusInTx(tx, dispatch.salesOrderId);

    const fullyReturned = dispatch.items.every((i) => (returnedByItem.get(i.id)?.total ?? 0) >= i.dispatchedQuantity);
    if (fullyReturned) {
      const { count } = await tx.dispatch.updateMany({ where: { id, status: dispatch.status }, data: { status: "REVERSED" } });
      if (count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Dispatch status changed during the return.", {});
    }
    return { created, fullyReturned };
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatch_returns",
    recordId: result.created.id,
    action: "CREATE",
    newValues: {
      dispatchNumber: dispatch.dispatchNumber,
      returnNumber,
      totalQuantity: result.created.totalQuantity,
      remarks: input.remarks,
      dispatchFullyReturned: result.fullyReturned,
    },
  });

  return result.created;
}

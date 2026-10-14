import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import { FinishedGoodsReceiptRepository } from "./finished-goods-receipt.repository";

const EPSILON = 0.0001; // matches createLot()'s own LotVariantBreakdown sum-tolerance exactly

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

export interface FinishedGoodsReceiptVariantInput {
  productVariantId: string;
  quantity: number;
}

export interface CreateFinishedGoodsReceiptParams {
  productId: string;
  lotId: string;
  jobOrderId: string;
  productionOrderId: string;
  warehouseId: string;
  /** The completed batch's flat total — the SAME number
   * completeAtFinalStageInTx() already posts today. Validated (not
   * recomputed) to equal the sum of variantBreakdown below. */
  quantity: number;
  variantBreakdown: FinishedGoodsReceiptVariantInput[];
}

/**
 * Finished Goods Inventory module (FGI-012) — creates a FinishedGoodsReceipt
 * header + one FinishedGoodsReceiptItem per colour/size line, posting one
 * `recordInventoryTransaction()` call per variant line (§6 point 3 of the
 * implementation plan).
 *
 * **A genuine double-counting risk found and fixed during this task, flagged
 * here rather than silently patched over:** §6 point 3's own literal wording
 * ("keeps posting its existing, unchanged PRODUCTION_RECEIPT ledger entry...
 * and *additionally* calls recordInventoryTransaction() once per colour/size
 * line") would, if followed verbatim, post the flat total AND the N
 * per-variant lines as (N+1) *separate* calls — but `recordInventoryTransaction()`'s
 * own `StockBalance` branch (FGI-010, already verified) is unconditional on
 * *every* call regardless of whether variant info is supplied. Literally
 * keeping the original flat call *and* adding N more would double-post the
 * flat `StockBalance` total (quantity + sum(breakdown) = 2x quantity). §7
 * point 2 describes the architecturally consistent, correct version of this
 * same idea for Dispatch: the per-line calls' sum *becomes* (replaces, not
 * adds to) the flat total — "the existing style-level number is always
 * exactly right, just now composed from several finer-grained ledger rows
 * instead of one." This function follows that same, non-double-counting
 * shape: it is the SOLE poster of inventory movement for a receipt event
 * with a real breakdown — once wired in (FGI-021), it REPLACES
 * `completeAtFinalStageInTx()`'s own direct `recordInventoryTransaction()`
 * call for that event, rather than running alongside it.
 * `FinishedGoodsReceipt.totalQuantity` is a stored summary of the validated
 * breakdown sum, never backed by its own separate ledger row.
 *
 * Deliberately NOT yet called from `completeAtFinalStageInTx()` — that
 * wiring, and the UI/API work to actually collect a real breakdown from a
 * user, are the later, dedicated FGI-020/FGI-021 tasks (Phase 2). This
 * function is complete and fully tested in isolation, ready to be called
 * once that wiring lands — the same "standalone now, wiring later" shape
 * already established for FGI-011's reservation functions.
 *
 * Idempotency is deliberately NOT rebuilt here, per §6 point 4 — this
 * function inherits the SAME protection that already guards the existing
 * flat PRODUCTION_RECEIPT posting today: `forwardJobOrder()`/
 * `recordQcInspection()` (the only two real callers of
 * `completeAtFinalStageInTx()`) already reject a retried/duplicate
 * completion attempt with `OVER_PRODUCTION_NOT_ALLOWED` before any write
 * happens (the ERP-BUG-0001 fix — `job-order.service.test.ts:649`, "rejects
 * inspecting quantity that has already been forwarded to the next stage").
 * Once this function is wired in behind that same guard, a retry can never
 * reach it a second time for the same event — no new, parallel idempotency
 * key is needed or built.
 *
 * **A second genuine conflict, found during Phase 2's own implementation and
 * corrected here (retroactively, since this function already shipped in
 * Phase 1) — every ledger posting below uses `referenceModule:
 * "PRODUCTION_ORDER"`, NOT `"FINISHED_GOODS_RECEIPT"`.** A pre-existing,
 * already-shipped feature (`getContributingLots()` in
 * `production-progress.service.ts`, built 2026-10-10 — real-Lot traceability
 * behind Dispatch's own Finished-Goods stock figure) queries
 * `InventoryTransaction` for `transactionType: "PRODUCTION_RECEIPT",
 * referenceModule: "PRODUCTION_ORDER"` as the one fixed signature of a real
 * production receipt. Using `"FINISHED_GOODS_RECEIPT"` here instead — this
 * function's original choice — would have silently dropped every
 * breakdown-tracked receipt out of that report the moment this function was
 * wired in (FGI-021), with no error anywhere to surface it. Confirmed via
 * this schema's own doc comment (`prisma/schema.prisma`, the `RelatedModule`
 * enum) that `FINISHED_GOODS_RECEIPT` was reserved in Phase 0 for a
 * genuinely different purpose — "Attachment/audit-log polymorphism for
 * FinishedGoodsReceipt" — never for `InventoryTransaction.referenceModule`;
 * the real link from a ledger row back to its originating receipt is
 * `FinishedGoodsReceiptItem.inventoryTransactionId` (already a real FK),
 * which doesn't depend on `referenceModule` at all. `referenceRecordId`
 * stays `lotId` either way, so `getContributingLots()`'s own grouping/join
 * logic needed no change once this was corrected to match its existing
 * convention.
 */
export async function createFinishedGoodsReceiptInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: CreateFinishedGoodsReceiptParams
) {
  if (params.variantBreakdown.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "At least one colour/size line is required to post a Finished Goods receipt.", {});
  }

  const breakdownSum = params.variantBreakdown.reduce((sum, row) => sum + row.quantity, 0);
  if (Math.abs(breakdownSum - params.quantity) > EPSILON) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `The colour/size breakdown (${breakdownSum}) must sum to exactly the completed quantity (${params.quantity}).`,
      { breakdownSum, quantity: params.quantity }
    );
  }

  const receiptNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "FG_RECEIPT",
  });

  const items: { productVariantId: string; quantity: number; inventoryTransactionId: string }[] = [];
  for (const row of params.variantBreakdown) {
    const ledgerRow = await recordInventoryTransaction(tx, actor, {
      productId: params.productId,
      warehouseId: params.warehouseId,
      transactionType: "PRODUCTION_RECEIPT",
      quantity: row.quantity,
      referenceModule: "PRODUCTION_ORDER",
      referenceRecordId: params.lotId,
      productVariantId: row.productVariantId,
      stockStatus: "SALEABLE",
    });
    items.push({ productVariantId: row.productVariantId, quantity: row.quantity, inventoryTransactionId: ledgerRow.id });
  }

  return FinishedGoodsReceiptRepository.createWithItemsInTx(tx, {
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    receiptNumber,
    productId: params.productId,
    lotId: params.lotId,
    jobOrderId: params.jobOrderId,
    productionOrderId: params.productionOrderId,
    warehouseId: params.warehouseId,
    // The validated breakdown sum, never independently recomputed — the
    // single-shared-input discipline §4.5 point 2 requires.
    totalQuantity: breakdownSum,
    postedByUserId: actor.userId,
    items,
  });
}

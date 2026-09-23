import type { Prisma, SalesOrderBomSourceType } from "@prisma/client";
import { BomRepository } from "@/modules/bom-mrp/bom.repository";
import { SampleVersionRepository } from "@/modules/sampling/sample.repository";
import { SalesOrderLineRepository, type ExistingSalesOrderLineRow } from "./sales-order-bom.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export interface SubmittedSalesOrderItem {
  salesOrderLineId?: string;
  productId: string;
  sampleRequestId: string | null;
  unitPrice: number;
  notes: string | null;
  breakdown: Array<{ productVariantId: string; orderedQuantity: number }>;
}

export type SalesOrderItemLineLink =
  | { kind: "reuse"; salesOrderLineId: string }
  | {
      kind: "new";
      lineNumber: number;
      sourceType: SalesOrderBomSourceType;
      bomVersionId: string | null;
      sampleVersionId: string | null;
      snapshotTakenAt: Date | null;
      snapshotTakenByUserId: string | null;
    };

export type ReconciledSalesOrderItem = SubmittedSalesOrderItem & { lineLink: SalesOrderItemLineLink };

/**
 * Resolves what a fresh snapshot for one line should capture right now —
 * the Style's currently-approved BomVersion when no sample is linked, or the
 * linked Sample's own currently-latest SampleVersion when one is (append-
 * only, so freezing its id here is what stops a later sample revision from
 * silently changing what an already-confirmed order thinks it needs — the
 * identical problem this whole feature exists to prevent for the Style-BOM
 * case, applied symmetrically). Returns the honest NONE/null shape when
 * there's genuinely nothing to snapshot yet (no approved BOM, or a Sample
 * with zero versions) — the Effective BOM resolver treats that exactly like
 * MRP's own pre-existing "no BOM defined for this style" degradation.
 */
export async function resolveSnapshotSource(
  companyId: string,
  item: { productId: string; sampleRequestId: string | null }
): Promise<{ sourceType: SalesOrderBomSourceType; bomVersionId: string | null; sampleVersionId: string | null }> {
  if (item.sampleRequestId) {
    const latestVersion = await SampleVersionRepository.findLatest(item.sampleRequestId);
    if (latestVersion) {
      return { sourceType: "SAMPLE_MATERIALS", bomVersionId: null, sampleVersionId: latestVersion.id };
    }
    return { sourceType: "NONE", bomVersionId: null, sampleVersionId: null };
  }

  const bom = await BomRepository.findApprovedVersionIdByProductId(companyId, item.productId);
  if (bom?.approvedVersionId) {
    return { sourceType: "STYLE_BOM", bomVersionId: bom.approvedVersionId, sampleVersionId: null };
  }
  return { sourceType: "NONE", bomVersionId: null, sampleVersionId: null };
}

/**
 * Decides, per submitted item, whether it reuses an existing SalesOrderLine
 * (its own frozen snapshot + any active SalesOrderBomOverride rows preserved
 * completely untouched) or needs a brand-new one:
 *  - a submitted salesOrderLineId that matches an existing line AND whose
 *    productId/sampleRequestId are unchanged -> reuse (an ordinary quantity/
 *    price/remarks-only edit).
 *  - no salesOrderLineId submitted at all -> a genuinely new line.
 *  - a submitted salesOrderLineId whose productId/sampleRequestId changed,
 *    or that doesn't match any existing line -> "re-evaluate/reset the BOM
 *    relationship safely," per explicit instruction: never carry an override
 *    authored against one style onto a line that now points at a different
 *    one. Treated as a new line.
 * An existing line whose id isn't referenced by ANY submitted item simply
 * ends up with no live item pointing at it after the caller's delete+
 * recreate — it goes dormant (its own overrides stop applying with nothing
 * further to do here), never deleted, preserving the audit trail.
 */
function planLineReuse(
  existingLines: ExistingSalesOrderLineRow[],
  submittedItems: SubmittedSalesOrderItem[]
): Array<{ kind: "reuse"; salesOrderLineId: string } | { kind: "new" }> {
  const existingById = new Map(existingLines.map((l) => [l.id, l]));

  return submittedItems.map((item) => {
    if (!item.salesOrderLineId) return { kind: "new" };
    const existing = existingById.get(item.salesOrderLineId);
    if (!existing) return { kind: "new" };

    const currentItem = existing.items[0];
    const sameProduct = currentItem?.productId === item.productId;
    const sameSample = (currentItem?.sampleRequestId ?? null) === (item.sampleRequestId ?? null);
    return sameProduct && sameSample ? { kind: "reuse", salesOrderLineId: existing.id } : { kind: "new" };
  });
}

/**
 * The single place both createSalesOrder() and updateSalesOrder() funnel
 * through to decide how each submitted item's SalesOrderLine should be
 * written. A snapshot is only ever taken here for a genuinely NEW line on an
 * order that's already CONFIRMED — a still-DRAFT order has nothing to
 * snapshot yet (that happens once, for every still-unsnapshotted line, at
 * confirmSalesOrder() time — see snapshotUnsnapshottedLinesInTx below).
 * Reused lines NEVER get a fresh snapshot here, even if the Style's Master
 * BOM has since moved to a newer approved version — moving an existing
 * confirmed line onto a newer version is only ever the explicit "Revise/
 * Refresh BOM" action's job (refreshSalesOrderLineBomSnapshot), never a side
 * effect of an ordinary edit.
 */
export async function buildReconciledItemPlan(
  actor: ActorContext,
  salesOrderId: string,
  isConfirmed: boolean,
  submittedItems: SubmittedSalesOrderItem[]
): Promise<ReconciledSalesOrderItem[]> {
  const existingLines = await SalesOrderLineRepository.findExistingForOrder(salesOrderId);
  const decisions = planLineReuse(existingLines, submittedItems);

  let nextLineNumber = existingLines.reduce((max, l) => Math.max(max, l.lineNumber), 0) + 1;

  const plan: ReconciledSalesOrderItem[] = [];
  for (let i = 0; i < submittedItems.length; i++) {
    const item = submittedItems[i];
    const decision = decisions[i];

    if (decision.kind === "reuse") {
      plan.push({ ...item, lineLink: { kind: "reuse", salesOrderLineId: decision.salesOrderLineId } });
      continue;
    }

    const lineNumber = nextLineNumber++;
    if (!isConfirmed) {
      plan.push({
        ...item,
        lineLink: { kind: "new", lineNumber, sourceType: "NONE", bomVersionId: null, sampleVersionId: null, snapshotTakenAt: null, snapshotTakenByUserId: null },
      });
      continue;
    }

    const snapshot = await resolveSnapshotSource(actor.companyId, item);
    plan.push({
      ...item,
      lineLink: {
        kind: "new",
        lineNumber,
        sourceType: snapshot.sourceType,
        bomVersionId: snapshot.bomVersionId,
        sampleVersionId: snapshot.sampleVersionId,
        snapshotTakenAt: snapshot.sourceType === "NONE" ? null : new Date(),
        snapshotTakenByUserId: snapshot.sourceType === "NONE" ? null : actor.userId,
      },
    });
  }

  return plan;
}

/**
 * Backfills a snapshot for every line still unsnapshotted (sourceType NONE)
 * the moment an order is confirmed — DRAFT -> CONFIRMED is the one true
 * "this order is now committed" event the spec describes. Called inside
 * confirmSalesOrder()'s own transaction so the status flip and every line's
 * snapshot commit together atomically. A dormant line with no live item is
 * skipped (nothing to snapshot); a line whose Style/Sample still has nothing
 * to capture is left honestly at NONE, not silently retried forever.
 */
export async function snapshotUnsnapshottedLinesInTx(tx: Prisma.TransactionClient, actor: ActorContext, salesOrderId: string) {
  const lines = await tx.salesOrderLine.findMany({
    where: { salesOrderId, sourceType: "NONE" },
    select: { id: true, items: { select: { productId: true, sampleRequestId: true } } },
  });

  for (const line of lines) {
    const currentItem = line.items[0];
    if (!currentItem) continue;

    const snapshot = await resolveSnapshotSource(actor.companyId, currentItem);
    if (snapshot.sourceType === "NONE") continue;

    await tx.salesOrderLine.update({
      where: { id: line.id },
      data: {
        sourceType: snapshot.sourceType,
        bomVersionId: snapshot.bomVersionId,
        sampleVersionId: snapshot.sampleVersionId,
        snapshotTakenAt: new Date(),
        snapshotTakenByUserId: actor.userId,
      },
    });
  }
}

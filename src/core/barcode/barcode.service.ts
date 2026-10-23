import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import { previewNextMasterCode, advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { BarcodeEntityType, Prisma } from "@prisma/client";
import { BarcodeRepository } from "./barcode.repository";
import type { GenerateBarcodeInput } from "./barcode.schema";

/**
 * Barcode Management & Scanning System, Phase 1 (2026-09-29).
 *
 * Barcode is an identification and workflow-trigger mechanism, never the
 * source of truth for a business transaction — every function here either
 * (a) registers a code against an entity that some other module's own
 * unmodified service already created/mutated, or (b) reads that registry
 * back out. Nothing in this file writes to InventoryTransaction, StockBalance,
 * JobOrder, Dispatch, or any other real business-state table.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

/**
 * Low-level primitive: registers `code` against one entity. Idempotent by
 * design — if the entity already has an ACTIVE barcode (a re-run of a
 * best-effort minting step, or the backfill script re-run against data it's
 * already covered), the existing row is returned rather than erroring. A
 * genuine code collision (the derived/minted code coincides with a
 * completely different, already-registered code) is a real data problem and
 * is surfaced as a clean VALIDATION_ERROR rather than a raw 500.
 *
 * `client` is either a transaction client (Goods Receipt's own roll-creation
 * transaction, an Item/SKU generate call) or the plain prisma singleton
 * (Lot/Carton's best-effort post-commit registration) — both are valid Prisma
 * query interfaces for a plain `create`.
 */
export async function registerBarcode(
  client: Prisma.TransactionClient | typeof prisma,
  actor: { companyId: string; userId?: string | null },
  input: { entityType: BarcodeEntityType; entityId: string; code: string }
) {
  try {
    return await BarcodeRepository.createInTx(client, {
      companyId: actor.companyId,
      code: input.code,
      entityType: input.entityType,
      entityId: input.entityId,
      createdByUserId: actor.userId ?? null,
    });
  } catch (err) {
    // barcodes_one_active_per_entity — this entity already has an active
    // barcode; return it instead of erroring (see doc comment above).
    if (isUniqueConstraintViolationOnColumn(err, "entity_id")) {
      const existing = await BarcodeRepository.findActiveByEntity(actor.companyId, input.entityType, input.entityId);
      if (existing) return existing;
    }
    // barcodes_company_id_code_key — the derived/minted code text itself
    // collides with an already-registered barcode. For a code that reuses a
    // stable, deterministic value (Lot.lotNumber, Product.styleCode, the
    // carton composite), this is the expected, legitimate shape of
    // "re-generate a barcode for an entity whose previous one was disabled"
    // — that entity's own OWN code is fixed forever, so a second `create`
    // for it always collides with its own now-DISABLED row, not a genuine
    // conflict. Distinguish the two by checking who the colliding code
    // actually belongs to, and reactivate rather than error when it's this
    // same entity — a minted (not derived) code colliding under a genuine
    // concurrent race is the only case this can't self-heal from, and that
    // case is real and correctly still rejected below.
    if (isUniqueConstraintViolationOnColumn(err, "code")) {
      const conflicting = await BarcodeRepository.findAnyByCode(actor.companyId, input.code);
      if (conflicting && conflicting.entityType === input.entityType && conflicting.entityId === input.entityId) {
        await BarcodeRepository.reactivate(actor.companyId, conflicting.id);
        return { ...conflicting, status: "ACTIVE" as const };
      }
      throw new BusinessRuleError("VALIDATION_ERROR", `Barcode "${input.code}" is already registered to a different item.`, {
        code: input.code,
      });
    }
    throw err;
  }
}

/** Removes a dispatch's carton barcodes after its cartons were deleted (e.g. its lines were edited). */
export async function clearCartonBarcodes(actor: ActorContext, dispatchNumber: string) {
  await BarcodeRepository.deleteCartonCodesForDispatch(actor.companyId, dispatchNumber);
}

/**
 * Mints a brand-new FABRIC_ROLL barcode code (prefix FR, never resets — the
 * same atomic document_sequences counter every other master code uses) and
 * registers it. Numbering is drawn OUTSIDE any surrounding business
 * transaction (matching this project's own established "draw the number,
 * then use it" convention — see generateDocumentNumber's own callers), so
 * this is always called as a best-effort step AFTER the Goods Receipt that
 * created the roll has already committed — see goods-receipt.service.ts's
 * createGoodsReceipt. A failure here never rolls back, and never blocks, the
 * real goods receipt.
 */
export async function mintFabricRollBarcode(actor: ActorContext, fabricRollId: string) {
  const code = await previewNextMasterCode(actor.companyId, "FABRIC_ROLL");
  const barcode = await registerBarcode(prisma, actor, { entityType: "FABRIC_ROLL", entityId: fabricRollId, code });
  if (barcode.code === code) {
    // Only advance the counter if OUR code actually got used (registerBarcode
    // may have returned a pre-existing row for this roll instead, in which
    // case advancing would waste a real sequence value for nothing).
    await advanceMasterCodeSequence(actor.companyId, "FABRIC_ROLL");
  }
  return barcode;
}

/**
 * Registers a PRODUCTION_LOT barcode reusing Lot.lotNumber verbatim — no
 * minting, the lot number is already unique per company. Called as a
 * best-effort step right after a Lot's own creation transaction commits (see
 * lot.service.ts's createLot).
 */
export async function registerProductionLotBarcode(actor: ActorContext, lotId: string, lotNumber: string) {
  return registerBarcode(prisma, actor, { entityType: "PRODUCTION_LOT", entityId: lotId, code: lotNumber });
}

/**
 * Cartons are deleted and recreated with fresh ids on every
 * Dispatch.setCartons() call (see dispatch.repository.ts) — so a prior call's
 * CARTON barcode rows are dangling the moment new cartons are written. This
 * cleans up the old rows for this dispatch's previous carton ids, then
 * registers a fresh one per new carton, using the derived
 * "<dispatchNumber>-C<cartonNumber>" code — the exact same composite string
 * DispatchWorkflowPanel.tsx already displays as a carton's barcode value, so
 * no new visual convention is introduced.
 *
 * Best-effort: called AFTER setCartons()'s own transaction has already
 * committed successfully; a failure here never undoes or blocks the real
 * carton write.
 */
export async function replaceCartonBarcodes(
  actor: ActorContext,
  input: { previousCartonIds: string[]; dispatchNumber: string; newCartons: { id: string; cartonNumber: number }[] }
) {
  await BarcodeRepository.deleteManyByEntityIds(actor.companyId, "CARTON", input.previousCartonIds);
  // Also clear this dispatch's carton codes by code: editing the dispatch's
  // lines deletes its cartons without passing their ids here, and a leftover
  // "<dispatchNumber>-C1" row would block the new C1 from registering.
  await BarcodeRepository.deleteCartonCodesForDispatch(actor.companyId, input.dispatchNumber);
  for (const carton of input.newCartons) {
    await registerBarcode(prisma, actor, {
      entityType: "CARTON",
      entityId: carton.id,
      code: `${input.dispatchNumber}-C${carton.cartonNumber}`,
    });
  }
}

/**
 * The one function behind the manual "Generate Barcode" action (Products/
 * Materials/Variant lists) — the only two entity types a user ever triggers
 * generation for directly, per this Phase 1's own scope trim (FABRIC_ROLL/
 * PRODUCTION_LOT/CARTON are always minted automatically at their entity's
 * own creation point, never manually).
 */
export async function generateItemOrSkuBarcode(actor: ActorContext, input: GenerateBarcodeInput) {
  if (input.entityType === "ITEM") {
    const product = await prisma.product.findFirst({
      where: { id: input.entityId, companyId: actor.companyId, itemType: "RAW_MATERIAL" },
      select: { id: true, styleCode: true },
    });
    if (!product) throw new BusinessRuleError("NOT_FOUND", "Raw material not found.", { id: input.entityId });
    return registerBarcode(prisma, actor, { entityType: "ITEM", entityId: product.id, code: product.styleCode });
  }

  const variant = await prisma.productVariant.findFirst({
    where: { id: input.entityId, product: { companyId: actor.companyId } },
    select: { id: true },
  });
  if (!variant) throw new BusinessRuleError("NOT_FOUND", "Style variant not found.", { id: input.entityId });

  const code = await previewNextMasterCode(actor.companyId, "SKU");
  const barcode = await registerBarcode(prisma, actor, { entityType: "SKU", entityId: variant.id, code });
  if (barcode.code === code) {
    await advanceMasterCodeSequence(actor.companyId, "SKU");
    // Denormalized read-cache — see ProductVariant.barcode's own schema
    // comment. Only refreshed when OUR code was actually the one registered.
    await prisma.productVariant.update({ where: { id: variant.id }, data: { barcode: code } });
  }
  return barcode;
}

export interface ResolvedBarcodeEntity {
  entityType: BarcodeEntityType;
  entityId: string;
  code: string;
  summary: Record<string, unknown>;
}

/**
 * The universal scan endpoint's own core logic — company-scoped, ACTIVE-only
 * lookup, then a per-entity-type summary read so the calling screen can show
 * "what did I just scan" without a second round-trip. Read-only: never
 * mutates anything. A code from another company, a DISABLED code, or an
 * unknown code all resolve to the same clean NOT_FOUND — never distinguished,
 * so a scanner can't be used to probe whether some other company's code
 * exists.
 */
export async function resolveBarcode(actor: ActorContext, code: string): Promise<ResolvedBarcodeEntity> {
  const barcode = await BarcodeRepository.findActiveByCode(actor.companyId, code);
  if (!barcode) throw new BusinessRuleError("NOT_FOUND", "No active barcode found for this code.", { code });

  const summary = await loadEntitySummaryForLabel(barcode.entityType, barcode.entityId);
  if (!summary) throw new BusinessRuleError("NOT_FOUND", "This barcode's underlying record no longer exists.", { code });

  return { entityType: barcode.entityType, entityId: barcode.entityId, code: barcode.code, summary };
}

/**
 * Exported (not just resolveBarcode's own private helper) so the label
 * reprint route can look up a DISABLED barcode's entity summary too —
 * resolveBarcode() itself is deliberately ACTIVE-only (the scan endpoint's
 * contract), which would be the wrong behavior for reprinting a label the
 * user already knows the id of via the Barcode Management screen.
 */
export async function loadEntitySummaryForLabel(entityType: BarcodeEntityType, entityId: string): Promise<Record<string, unknown> | null> {
  switch (entityType) {
    case "FABRIC_ROLL": {
      const roll = await prisma.fabricRoll.findUnique({
        where: { id: entityId },
        select: {
          id: true,
          rollNumber: true,
          rollQuantity: true,
          remainingQuantity: true,
          status: true,
          goodsReceiptItem: { select: { product: { select: { id: true, styleName: true, styleCode: true } } } },
        },
      });
      if (!roll) return null;
      return {
        kind: "FABRIC_ROLL",
        id: roll.id,
        rollNumber: roll.rollNumber,
        rollQuantity: Number(roll.rollQuantity),
        remainingQuantity: Number(roll.remainingQuantity),
        status: roll.status,
        materialId: roll.goodsReceiptItem.product.id,
        materialName: roll.goodsReceiptItem.product.styleName,
        materialCode: roll.goodsReceiptItem.product.styleCode,
      };
    }
    case "PRODUCTION_LOT": {
      const lot = await prisma.lot.findUnique({
        where: { id: entityId },
        select: {
          id: true,
          lotNumber: true,
          quantity: true,
          status: true,
          productionOrder: { select: { id: true, orderNumber: true, product: { select: { styleName: true } } } },
        },
      });
      if (!lot) return null;
      return {
        kind: "PRODUCTION_LOT",
        id: lot.id,
        lotNumber: lot.lotNumber,
        quantity: Number(lot.quantity),
        status: lot.status,
        productionOrderId: lot.productionOrder.id,
        productionOrderNumber: lot.productionOrder.orderNumber,
        styleName: lot.productionOrder.product.styleName,
      };
    }
    case "CARTON": {
      const carton = await prisma.carton.findUnique({
        where: { id: entityId },
        select: { id: true, cartonNumber: true, totalQuantity: true, dispatch: { select: { id: true, dispatchNumber: true, status: true } } },
      });
      if (!carton) return null;
      return {
        kind: "CARTON",
        id: carton.id,
        cartonNumber: carton.cartonNumber,
        totalQuantity: carton.totalQuantity,
        dispatchId: carton.dispatch.id,
        dispatchNumber: carton.dispatch.dispatchNumber,
        dispatchStatus: carton.dispatch.status,
      };
    }
    case "ITEM": {
      const product = await prisma.product.findUnique({
        where: { id: entityId },
        select: { id: true, styleCode: true, styleName: true, materialCategory: true, isActive: true },
      });
      if (!product) return null;
      return {
        kind: "ITEM",
        id: product.id,
        styleCode: product.styleCode,
        styleName: product.styleName,
        materialCategory: product.materialCategory,
        isActive: product.isActive,
      };
    }
    case "SKU": {
      const variant = await prisma.productVariant.findUnique({
        where: { id: entityId },
        select: {
          id: true,
          skuCode: true,
          isActive: true,
          product: { select: { id: true, styleCode: true, styleName: true } },
          color: { select: { name: true } },
          size: { select: { name: true } },
        },
      });
      if (!variant) return null;
      return {
        kind: "SKU",
        id: variant.id,
        skuCode: variant.skuCode,
        isActive: variant.isActive,
        productId: variant.product.id,
        styleName: variant.product.styleName,
        styleCode: variant.product.styleCode,
        colorName: variant.color.name,
        sizeName: variant.size.name,
      };
    }
    case "PRODUCT_UNIT": {
      const unit = await prisma.productUnit.findUnique({
        where: { id: entityId },
        include: {
          product: { select: { id: true, styleCode: true, styleName: true } },
          productVariant: { include: { color: true, size: true } },
          productionOrder: { select: { id: true, orderNumber: true } },
          lot: { select: { id: true, lotNumber: true } },
          salesOrder: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
          carton: { select: { id: true, cartonNumber: true, dispatch: { select: { dispatchNumber: true } } } },
        },
      });
      if (!unit) return null;
      return {
        kind: "PRODUCT_UNIT",
        id: unit.id,
        unitCode: unit.unitCode,
        status: unit.status,
        styleName: unit.product.styleName,
        styleCode: unit.product.styleCode,
        colorName: unit.productVariant.color.name,
        sizeName: unit.productVariant.size.name,
        lotNumber: unit.lot.lotNumber,
        productionOrderNumber: unit.productionOrder.orderNumber,
        salesOrderNumber: unit.salesOrder?.orderNumber ?? null,
        customerName: unit.salesOrder?.customer?.name ?? null,
        cartonNumber: unit.carton?.cartonNumber ?? null,
        dispatchNumber: unit.carton?.dispatch?.dispatchNumber ?? null,
      };
    }
    default:
      return null;
  }
}

const VALID_ENTITY_TYPES = new Set(["FABRIC_ROLL", "PRODUCTION_LOT", "CARTON", "ITEM", "SKU", "PRODUCT_UNIT"]);
const VALID_STATUSES = new Set(["ACTIVE", "DISABLED"]);

export async function listBarcodes(actor: ActorContext, query: ListQuery & { entityType?: string }) {
  const where: Prisma.BarcodeWhereInput = {
    companyId: actor.companyId,
    ...(query.search ? { code: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.entityType && VALID_ENTITY_TYPES.has(query.entityType) ? { entityType: query.entityType as BarcodeEntityType } : {}),
    ...(query.status && VALID_STATUSES.has(query.status) ? { status: query.status as "ACTIVE" | "DISABLED" } : {}),
  };

  const [data, totalCount] = await Promise.all([
    BarcodeRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    BarcodeRepository.count(where),
  ]);

  return { data, totalCount };
}

/** "Disable" is the only correction available for a barcode — no delete, matching this schema's no-hard-delete discipline for every other transactional/master table. Mints nothing new; generating a replacement (e.g. after a damaged physical label) is a separate, later "Generate Barcode" call the disabled row doesn't block. */
export async function disableBarcode(actor: ActorContext, id: string) {
  const before = await BarcodeRepository.findById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Barcode not found.", { id });
  if (before.status === "DISABLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This barcode is already disabled.", { id });
  }

  const result = await BarcodeRepository.disable(actor.companyId, id);
  if (result.count === 0) throw new BusinessRuleError("NOT_FOUND", "Barcode not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "barcodes",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: "DISABLED" },
  });

  return BarcodeRepository.findById(actor.companyId, id);
}

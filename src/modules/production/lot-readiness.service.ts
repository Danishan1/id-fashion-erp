import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { getMaterialRequirementForOrderLine } from "@/modules/bom-mrp/mrp.service";
import { getPlanFabricReplacements } from "./color-fabric-plan.service";
import { ProductionOrderRepository } from "./production.repository";
import { materialRequestScopeForOrder } from "./material-request-scope";

const EPSILON = 0.0001;

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

/** Lots whose own quantity still counts toward what the order is producing —
 * a SPLIT/MERGED parent's quantity lives on in its children, and a CANCELLED
 * lot produces nothing, so counting either would double-count or overstate. */
const COUNTED_LOT_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] as const;

export interface LotMaterialReadinessRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  /** Effective-BOM consumption for ONE piece, in the material's base unit. */
  perPieceQuantity: number;
  /** perPieceQuantity × every counted lot's pieces (including the new one). */
  requiredQuantity: number;
  /** Everything actually issued so far against this order's own material requests. */
  issuedQuantity: number;
  /** max(0, required − issued). */
  remainingQuantity: number;
}

export interface LotMaterialReadiness {
  /** Pieces already in this order's existing lots. */
  existingLotPieces: number;
  /** The new lot's own pieces (0 when checking an existing lot). */
  newLotPieces: number;
  /** existingLotPieces + newLotPieces — what the issued material must cover. */
  totalPieces: number;
  hasMaterialPlan: boolean;
  materialRequestCount: number;
  rows: LotMaterialReadinessRow[];
  /** True only when a material request exists AND every planned material's
   * issued quantity covers its required quantity. */
  ready: boolean;
  /** The first blocking reason in plain language, or null when ready. */
  blockingMessage: string | null;
}

function fmt(n: number) {
  return round4(n).toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

/**
 * The Production Lot material gate (2026-09-29). A lot may only be created
 * (and so start at Cutting) once this order has a material request and the
 * material ISSUED against it covers every counted lot's pieces × the
 * Effective-BOM per-piece consumption — cumulative across lots, so issuing
 * enough for the first 5 pieces never quietly covers a second lot too.
 * Partial issues are allowed at the store; this is where "not enough yet" is
 * enforced. Read-only and side-effect free, so the Add Lot modal previews
 * exactly the numbers createLot/startLot will enforce.
 */
export async function getLotMaterialReadiness(
  companyId: string,
  productionOrderId: string,
  options: { newLotPieces: number; excludeLotId?: string }
): Promise<LotMaterialReadiness> {
  const order = await ProductionOrderRepository.findAnyById(companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });

  const lotAgg = await prisma.lot.aggregate({
    where: {
      companyId,
      productionOrderId,
      status: { in: [...COUNTED_LOT_STATUSES] },
      ...(options.excludeLotId ? { id: { not: options.excludeLotId } } : {}),
    },
    _sum: { quantity: true },
  });
  const existingLotPieces = Number(lotAgg._sum.quantity ?? 0);
  const newLotPieces = options.newLotPieces;
  const totalPieces = existingLotPieces + newLotPieces;

  // Requests raised from this order, or earlier from BOM/MRP against its Sales Order.
  const requestScope = await materialRequestScopeForOrder(companyId, productionOrderId, order.salesOrderItemId);
  const materialRequestCount = await prisma.materialRequest.count({
    where: { ...requestScope, status: { not: "CANCELLED" } },
  });

  // Per-piece consumption from the same Effective-BOM resolver every other
  // planning surface uses — quantity 1 so the result IS the per-piece need.
  const requirement = await getMaterialRequirementForOrderLine(companyId, {
    salesOrderItemId: order.salesOrderItemId,
    productId: order.productId,
    quantity: 1,
  });

  // Issued so far, per original material, from the request lines themselves:
  // a Material Substitution books its issue against the ORIGINAL line's own
  // issuedQuantity, so a substitute correctly counts toward the material it
  // replaced.
  const lines = await prisma.materialRequestItem.findMany({
    where: { materialRequest: { ...requestScope, status: { not: "CANCELLED" } } },
    select: {
      materialId: true,
      issuedQuantity: true,
      uom: { select: { id: true, baseUnitId: true, conversionFactor: true } },
      material: { select: { baseUom: { select: { id: true, baseUnitId: true, conversionFactor: true } } } },
    },
  });
  const issuedByMaterial = new Map<string, number>();
  for (const line of lines) {
    const issued = Number(line.issuedQuantity);
    if (issued <= 0) continue;
    const base = line.material.baseUom;
    const converted = base ? convertUomQuantity(issued, line.uom, base) : issued;
    issuedByMaterial.set(line.materialId, (issuedByMaterial.get(line.materialId) ?? 0) + (converted ?? 0));
  }
  // A fabric chosen in the colour-wise fabric plan instead of the BOM's own
  // fabric stands in for it (2026-10-21).
  const replacements = await getPlanFabricReplacements(companyId, productionOrderId);
  for (const [chosenId, bomMaterialId] of replacements) {
    const issued = issuedByMaterial.get(chosenId);
    if (!issued) continue;
    issuedByMaterial.set(bomMaterialId, (issuedByMaterial.get(bomMaterialId) ?? 0) + issued);
  }

  const rows: LotMaterialReadinessRow[] = requirement.materials
    .filter((m) => m.neededQuantity > 0)
    .map((m) => {
      const perPieceQuantity = round4(m.neededQuantity);
      const requiredQuantity = round4(m.neededQuantity * totalPieces);
      const issuedQuantity = round4(issuedByMaterial.get(m.materialId) ?? 0);
      return {
        materialId: m.materialId,
        materialName: m.materialName,
        materialCode: m.materialCode,
        uomCode: m.uomCode,
        perPieceQuantity,
        requiredQuantity,
        issuedQuantity,
        remainingQuantity: round4(Math.max(0, requiredQuantity - issuedQuantity)),
      };
    })
    .sort((a, b) => b.remainingQuantity - a.remainingQuantity || a.materialName.localeCompare(b.materialName));

  const hasMaterialPlan = requirement.hasApprovedBom && rows.length > 0;

  let blockingMessage: string | null = null;
  if (!hasMaterialPlan && requirement.unconvertibleLines.length > 0) {
    const first = requirement.unconvertibleLines[0];
    blockingMessage = `Cannot calculate the material requirement: ${first.materialName} — ${first.reason}. Fix the unit on the BOM line or the material's base unit.`;
  } else if (!hasMaterialPlan) {
    blockingMessage = requirement.sampleRequestId
      ? "The linked sample has no materials recorded yet, so no material requirement can be calculated. Record the sample's materials first."
      : "This style has no approved BOM, so no material requirement can be calculated. Approve a BOM version first.";
  } else if (materialRequestCount === 0) {
    blockingMessage =
      "Cutting worker assignment, material request and material issue are required before creating the production lot. No material request exists for this production order or its Sales Order yet — generate one first.";
  } else {
    const short = rows.find((r) => r.remainingQuantity > EPSILON);
    if (short) {
      blockingMessage = `Insufficient material quantity. Required quantity is ${fmt(short.requiredQuantity)} ${short.uomCode} of ${short.materialName} for ${fmt(totalPieces)} PCS (${fmt(short.perPieceQuantity)} ${short.uomCode}/PCS); issued so far is ${fmt(short.issuedQuantity)} ${short.uomCode}. Issue the remaining ${fmt(short.remainingQuantity)} ${short.uomCode} first.`;
    }
  }

  return {
    existingLotPieces,
    newLotPieces,
    totalPieces,
    hasMaterialPlan,
    materialRequestCount,
    rows,
    ready: blockingMessage === null,
    blockingMessage,
  };
}

/** Throws the readiness check's own message when the lot may not proceed. */
export async function assertLotMaterialReady(
  companyId: string,
  productionOrderId: string,
  options: { newLotPieces: number; excludeLotId?: string }
) {
  const readiness = await getLotMaterialReadiness(companyId, productionOrderId, options);
  if (!readiness.ready) {
    throw new BusinessRuleError(
      readiness.hasMaterialPlan && readiness.materialRequestCount > 0 ? "INSUFFICIENT_RAW_MATERIAL_STOCK" : "VALIDATION_ERROR",
      readiness.blockingMessage ?? "Material is not ready for this lot.",
      { totalPieces: readiness.totalPieces, rows: readiness.rows }
    );
  }
  return readiness;
}

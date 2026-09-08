import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { sumAvailableByProductIds } from "@/modules/inventory/inventory.service";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { BomRepository } from "./bom.repository";

// Every quantity here accumulates through repeated floating-point addition
// (contributingStyles across multiple BOM lines/order items), which
// otherwise surfaces IEEE-754 noise like 103.60000000000002 in the JSON
// response. Rounds to the same 4-decimal precision this project's own
// Decimal(18,4) quantity columns already use everywhere else.
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

interface ContributingStyle {
  productId: string;
  styleName: string;
  neededQuantity: number;
}

interface MaterialRequirementRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomId: string;
  uomCode: string;
  neededQuantity: number;
  availableQuantity: number;
  shortfallQuantity: number;
  defaultSupplierId: string | null;
  unitCost: number | null;
  contributingStyles: ContributingStyle[];
}

/**
 * Computes needed/available/shortfall per material for a Sales Order's
 * style lines against their BOMs. Purely informational — no status
 * restriction, no stock reservation happens here (that's Production's, 5C's,
 * job once a Production Order actually reserves stock). Aggregates by
 * materialId only (never materialId+uomId — a mixed-unit sum would be
 * wrong if the same material is used at different chosen uomIds across
 * different BOM lines); every reported quantity is in the material's own
 * base UOM, converted via convertUomQuantity.
 */
export async function getMaterialRequirements(companyId: string, salesOrderId: string) {
  // SalesOrderRepository.findByIdWithDetails is already company-scoped —
  // reuse as-is, do not add a second, unscoped lookup.
  const order = await SalesOrderRepository.findByIdWithDetails(companyId, salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: salesOrderId });

  const styleProductIds = [...new Set(order.items.map((item) => item.productId))];
  const boms = await BomRepository.findManyByProductIds(companyId, styleProductIds);
  const bomByProductId = new Map(boms.map((bom) => [bom.productId, bom]));

  const stylesWithoutBom: Array<{ productId: string; styleName: string }> = [];
  const rowsByMaterialId = new Map<string, MaterialRequirementRow>();
  const unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }> = [];

  for (const orderItem of order.items) {
    const bom = bomByProductId.get(orderItem.productId);
    // An unapproved draft (or no BOM at all) is treated identically —
    // material planning must never silently consume an edit-in-progress
    // that no one has signed off on yet (see docs/PRACTICAL_BUSINESS_READY_
    // AUDIT.md Section 4 — this is the real gate that was missing before).
    const approvedItems = bom?.approvedVersion?.items ?? [];
    if (approvedItems.length === 0) {
      stylesWithoutBom.push({ productId: orderItem.productId, styleName: orderItem.product.styleName });
      continue;
    }

    for (const bomItem of approvedItems) {
      const matchingBreakdown = orderItem.breakdown.filter(
        (b) => !bomItem.colorId || b.productVariant.color.id === bomItem.colorId
      );
      const orderedQty = matchingBreakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
      if (orderedQty === 0) continue;

      const effectiveQtyInBomUnit = Number(bomItem.quantityPerUnit) * (1 + Number(bomItem.wastagePercentage) / 100) * orderedQty;

      if (!bomItem.material.baseUom) {
        unconvertibleLines.push({
          materialId: bomItem.materialId,
          materialName: bomItem.material.styleName,
          reason: "no base unit configured",
        });
        continue;
      }

      const neededInBaseUom = convertUomQuantity(effectiveQtyInBomUnit, bomItem.uom, bomItem.material.baseUom);
      if (neededInBaseUom === null) {
        unconvertibleLines.push({
          materialId: bomItem.materialId,
          materialName: bomItem.material.styleName,
          reason: `"${bomItem.uom.name}" has no fixed conversion to its base unit`,
        });
        continue;
      }

      const existing = rowsByMaterialId.get(bomItem.materialId);
      if (existing) {
        existing.neededQuantity += neededInBaseUom;
        // Merge into an already-listed style rather than pushing a second
        // entry — a style can reach this material through more than one
        // BOM line (e.g. two different color-specific lines), and without
        // this it appeared twice with a partial quantity each, instead of
        // once with the correct total.
        const existingStyle = existing.contributingStyles.find((s) => s.productId === orderItem.productId);
        if (existingStyle) {
          existingStyle.neededQuantity += neededInBaseUom;
        } else {
          existing.contributingStyles.push({
            productId: orderItem.productId,
            styleName: orderItem.product.styleName,
            neededQuantity: neededInBaseUom,
          });
        }
      } else {
        rowsByMaterialId.set(bomItem.materialId, {
          materialId: bomItem.materialId,
          materialName: bomItem.material.styleName,
          materialCode: bomItem.material.styleCode,
          uomId: bomItem.material.baseUom.id,
          uomCode: bomItem.material.baseUom.code,
          neededQuantity: neededInBaseUom,
          availableQuantity: 0,
          shortfallQuantity: 0,
          defaultSupplierId: bomItem.material.defaultSupplierId,
          unitCost: bomItem.material.unitCost ? Number(bomItem.material.unitCost) : null,
          contributingStyles: [{ productId: orderItem.productId, styleName: orderItem.product.styleName, neededQuantity: neededInBaseUom }],
        });
      }
    }
  }

  const materialIds = [...rowsByMaterialId.keys()];
  const availableByMaterialId = await sumAvailableByProductIds(companyId, materialIds);

  const materials = [...rowsByMaterialId.values()].map((row) => {
    const availableQuantity = availableByMaterialId.get(row.materialId) ?? 0;
    return {
      ...row,
      neededQuantity: round4(row.neededQuantity),
      availableQuantity: round4(availableQuantity),
      shortfallQuantity: round4(Math.max(0, row.neededQuantity - availableQuantity)),
      contributingStyles: row.contributingStyles.map((s) => ({ ...s, neededQuantity: round4(s.neededQuantity) })),
    };
  });

  materials.sort((a, b) => b.shortfallQuantity - a.shortfallQuantity || a.materialName.localeCompare(b.materialName));

  return {
    salesOrder: { orderNumber: order.orderNumber, customerName: order.customer.name },
    materials,
    stylesWithoutBom,
    unconvertibleLines,
  };
}

export interface StyleMaterialRequirementRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomId: string;
  uomCode: string;
  neededQuantity: number;
  availableQuantity: number;
  shortfallQuantity: number;
  unitCost: number | null;
  /** null whenever unitCost is null — never a silent 0, matching this
   * project's "flag as unavailable rather than undercount" convention
   * (see makeStyleMaterialCostResolver in profitability.reports.ts). */
  lineCost: number | null;
}

export interface StyleMaterialRequirementResult {
  productId: string;
  bomId: string | null;
  hasApprovedBom: boolean;
  materials: StyleMaterialRequirementRow[];
  unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }>;
  /** null if this style has no approved BOM, any BomItem's material has no
   * unitCost, or any line couldn't be converted to its base UOM — an
   * undercounted total would be worse than an honest "unavailable". */
  totalMaterialCost: number | null;
  materialCostPerUnit: number | null;
}

/**
 * The single source of truth for "given this style and this quantity, what
 * materials are needed and what would they cost" — the same BOM-explosion
 * math getMaterialRequirements above already uses (properly converted to
 * each material's base UOM before comparing against real stock), just keyed
 * on a flat quantity instead of a Sales Order's own color/size breakdown.
 * Two real callers: the Production Order create/edit form's live preview
 * (quantity = the order's own, freely editable plannedQuantity — can differ
 * from what the linked Sales Order actually ordered) and
 * generateMaterialRequestForOrder in production-order.service.ts, which
 * reuses this instead of its own former ad hoc calc that never converted to
 * base UOM before comparing against available stock (the exact class of bug
 * this project already fixed once for the Sales-Order-driven calc above).
 */
export async function getStyleMaterialRequirement(
  companyId: string,
  productId: string,
  quantity: number
): Promise<StyleMaterialRequirementResult> {
  const bom = await BomRepository.findByProductId(companyId, productId);
  const approvedItems = bom?.approvedVersion?.items ?? [];

  if (approvedItems.length === 0) {
    return {
      productId,
      bomId: bom?.id ?? null,
      hasApprovedBom: false,
      materials: [],
      unconvertibleLines: [],
      totalMaterialCost: null,
      materialCostPerUnit: null,
    };
  }

  const rowsByMaterialId = new Map<
    string,
    { materialName: string; materialCode: string; uomId: string; uomCode: string; neededQuantity: number; unitCost: number | null }
  >();
  const unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }> = [];

  for (const item of approvedItems) {
    const effectiveQtyPerUnit = Number(item.quantityPerUnit) * (1 + Number(item.wastagePercentage) / 100);
    const neededInBomUnit = effectiveQtyPerUnit * quantity;

    if (!item.material.baseUom) {
      unconvertibleLines.push({ materialId: item.materialId, materialName: item.material.styleName, reason: "no base unit configured" });
      continue;
    }

    const neededInBaseUom = convertUomQuantity(neededInBomUnit, item.uom, item.material.baseUom);
    if (neededInBaseUom === null) {
      unconvertibleLines.push({
        materialId: item.materialId,
        materialName: item.material.styleName,
        reason: `"${item.uom.name}" has no fixed conversion to its base unit`,
      });
      continue;
    }

    const existing = rowsByMaterialId.get(item.materialId);
    if (existing) {
      existing.neededQuantity += neededInBaseUom;
    } else {
      rowsByMaterialId.set(item.materialId, {
        materialName: item.material.styleName,
        materialCode: item.material.styleCode,
        uomId: item.material.baseUom.id,
        uomCode: item.material.baseUom.code,
        neededQuantity: neededInBaseUom,
        unitCost: item.material.unitCost ? Number(item.material.unitCost) : null,
      });
    }
  }

  const materialIds = [...rowsByMaterialId.keys()];
  const availableByMaterialId = await sumAvailableByProductIds(companyId, materialIds);

  let totalMaterialCost = 0;
  let allCostsKnown = unconvertibleLines.length === 0;

  const materials: StyleMaterialRequirementRow[] = [...rowsByMaterialId.entries()]
    .map(([materialId, row]) => {
      const availableQuantity = availableByMaterialId.get(materialId) ?? 0;
      const lineCost = row.unitCost !== null ? round4(row.neededQuantity * row.unitCost) : null;
      if (lineCost === null) allCostsKnown = false;
      else totalMaterialCost += lineCost;
      return {
        materialId,
        materialName: row.materialName,
        materialCode: row.materialCode,
        uomId: row.uomId,
        uomCode: row.uomCode,
        neededQuantity: round4(row.neededQuantity),
        availableQuantity: round4(availableQuantity),
        shortfallQuantity: round4(Math.max(0, row.neededQuantity - availableQuantity)),
        unitCost: row.unitCost,
        lineCost,
      };
    })
    .sort((a, b) => a.materialName.localeCompare(b.materialName));

  return {
    productId,
    bomId: bom?.id ?? null,
    hasApprovedBom: true,
    materials,
    unconvertibleLines,
    totalMaterialCost: allCostsKnown ? round4(totalMaterialCost) : null,
    materialCostPerUnit: allCostsKnown && quantity > 0 ? round4(totalMaterialCost / quantity) : null,
  };
}

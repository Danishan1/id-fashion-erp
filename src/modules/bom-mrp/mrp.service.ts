import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { sumAvailableByProductIds } from "@/modules/inventory/inventory.service";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { BomRepository } from "./bom.repository";

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
    if (!bom || bom.items.length === 0) {
      stylesWithoutBom.push({ productId: orderItem.productId, styleName: orderItem.product.styleName });
      continue;
    }

    for (const bomItem of bom.items) {
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
        existing.contributingStyles.push({
          productId: orderItem.productId,
          styleName: orderItem.product.styleName,
          neededQuantity: neededInBaseUom,
        });
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
    return { ...row, availableQuantity, shortfallQuantity: Math.max(0, row.neededQuantity - availableQuantity) };
  });

  materials.sort((a, b) => b.shortfallQuantity - a.shortfallQuantity || a.materialName.localeCompare(b.materialName));

  return {
    salesOrder: { orderNumber: order.orderNumber, customerName: order.customer.name },
    materials,
    stylesWithoutBom,
    unconvertibleLines,
  };
}

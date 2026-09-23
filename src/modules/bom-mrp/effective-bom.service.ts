import { prisma } from "@/core/db/client";
import { BomRepository } from "./bom.repository";
import { SampleMaterialRepository } from "@/modules/sampling/sample.repository";
import type { ExplosionLineItem } from "./mrp.service";

/**
 * Effective BOM resolver (2026-09-24). This is the ONE place downstream
 * planning (MRP, Material Requirement Preview, Material Request, Production
 * Requirement) applies a Sales Order Line's own frozen BOM/Sample snapshot
 * and any active SalesOrderBomOverride rows on top of whichever base
 * resolution mrp.service.ts's existing resolveExplosionItemsForOrderItem()
 * would otherwise return — per the user's own explicit instruction, "do not
 * allow different modules to independently calculate different BOMs."
 *
 * Deliberately a thin WRAPPER, not a rewrite of the existing resolver: a
 * line with no snapshot yet (a still-DRAFT order, or any pre-existing order
 * created before this feature shipped) falls straight through to the
 * existing base resolution completely unchanged — this is what keeps every
 * Sales Order with zero overrides/substitutions behaving byte-identically to
 * before this feature, the explicit regression bar the user set.
 */

/**
 * One ACTIVE SalesOrderBomOverride, already resolved to a real
 * Product/UnitOfMeasure row (never a raw id an applier would need a second
 * async lookup for) — this is what makes applyEffectiveBomResolution below a
 * pure, synchronous function with zero DB access of its own.
 */
export interface ResolvedSalesOrderLineOverride {
  originalMaterialId: string | null;
  /** null when this override targets a material row that no longer resolves
   * (deleted, or belongs to a different company) — the override is skipped
   * defensively rather than thrown, since this runs inside read-only
   * planning paths, not a mutation; the override-management CRUD service
   * itself (Phase 3, below) is what actually prevents this at write time. */
  effectiveMaterial: {
    materialId: string;
    styleName: string;
    styleCode: string;
    baseUom: ExplosionLineItem["uom"];
    defaultSupplierId: string | null;
    unitCost: unknown;
  } | null;
  effectiveQuantityPerUnit: number | null;
  wastagePercentage: number | null;
  colorId: string | null;
  effectiveUom: ExplosionLineItem["uom"] | null;
}

export interface SalesOrderLineSnapshot {
  id: string;
  sourceType: "STYLE_BOM" | "SAMPLE_MATERIALS" | "NONE";
  /** null = this line has nothing frozen to substitute in (sourceType NONE,
   * or a snapshot pointer whose own target row has since been deleted) — the
   * caller should keep using its own live-resolved base in that case. An
   * empty array is a real, meaningful state (the frozen version genuinely
   * had zero items at snapshot time), distinct from null. */
  snapshotExplosionItems: ExplosionLineItem[] | null;
  activeOverrides: ResolvedSalesOrderLineOverride[];
}

/**
 * Batch-fetches every requested SalesOrderLine's own frozen snapshot
 * (BomVersion.items or SampleVersion's materials, whichever this line
 * captured) plus its currently ACTIVE overrides, resolving every override's
 * own effectiveMaterialId/uomId to a real Product/UnitOfMeasure row in the
 * same pass — one batched query per data source across ALL requested lines,
 * never N+1 per line, so this stays cheap even from a 200-order batch
 * caller (getSalesOrdersMaterialStatus).
 */
export async function fetchSalesOrderLineSnapshots(
  companyId: string,
  salesOrderLineIds: string[]
): Promise<Map<string, SalesOrderLineSnapshot>> {
  const result = new Map<string, SalesOrderLineSnapshot>();
  if (salesOrderLineIds.length === 0) return result;

  const lines = await prisma.salesOrderLine.findMany({
    where: { id: { in: salesOrderLineIds }, companyId },
    select: {
      id: true,
      sourceType: true,
      bomVersionId: true,
      sampleVersionId: true,
      overrides: {
        where: { isActive: true },
        select: {
          originalMaterialId: true,
          effectiveMaterialId: true,
          effectiveQuantityPerUnit: true,
          wastagePercentage: true,
          colorId: true,
          uomId: true,
        },
      },
    },
  });
  if (lines.length === 0) return result;

  const bomVersionIds = [...new Set(lines.map((l) => l.bomVersionId).filter((id): id is string => !!id))];
  const sampleVersionIds = [...new Set(lines.map((l) => l.sampleVersionId).filter((id): id is string => !!id))];

  const overrideMaterialIds = new Set<string>();
  const overrideUomIds = new Set<string>();
  for (const line of lines) {
    for (const o of line.overrides) {
      if (o.effectiveMaterialId) overrideMaterialIds.add(o.effectiveMaterialId);
      if (o.uomId) overrideUomIds.add(o.uomId);
    }
  }

  const [bomVersions, sampleMaterialRows, overrideMaterials, overrideUoms] = await Promise.all([
    bomVersionIds.length > 0 ? BomRepository.findManyVersionsByIds(bomVersionIds) : Promise.resolve([]),
    sampleVersionIds.length > 0 ? SampleMaterialRepository.findManyByVersionIds(sampleVersionIds) : Promise.resolve([]),
    overrideMaterialIds.size > 0
      ? prisma.product.findMany({
          where: { id: { in: [...overrideMaterialIds] }, companyId },
          select: {
            id: true,
            styleName: true,
            styleCode: true,
            defaultSupplierId: true,
            unitCost: true,
            baseUom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
          },
        })
      : Promise.resolve([]),
    overrideUomIds.size > 0
      ? prisma.unitOfMeasure.findMany({
          where: { id: { in: [...overrideUomIds] } },
          select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true },
        })
      : Promise.resolve([]),
  ]);

  const bomVersionById = new Map(bomVersions.map((v) => [v.id, v]));
  const materialById = new Map(overrideMaterials.map((m) => [m.id, m]));
  const uomById = new Map(overrideUoms.map((u) => [u.id, u]));

  const sampleMaterialsByVersionId = new Map<string, typeof sampleMaterialRows>();
  for (const row of sampleMaterialRows) {
    const list = sampleMaterialsByVersionId.get(row.sampleVersionId) ?? [];
    list.push(row);
    sampleMaterialsByVersionId.set(row.sampleVersionId, list);
  }

  for (const line of lines) {
    let snapshotExplosionItems: ExplosionLineItem[] | null = null;

    if (line.sourceType === "STYLE_BOM" && line.bomVersionId) {
      const version = bomVersionById.get(line.bomVersionId);
      if (version) {
        snapshotExplosionItems = version.items.map((item) => ({
          materialId: item.materialId,
          colorId: item.colorId,
          quantityPerUnit: Number(item.quantityPerUnit),
          wastagePercentage: Number(item.wastagePercentage),
          uom: item.uom,
          material: {
            styleName: item.material.styleName,
            styleCode: item.material.styleCode,
            baseUom: item.material.baseUom,
            defaultSupplierId: item.material.defaultSupplierId,
            unitCost: item.material.unitCost,
          },
        }));
      }
    } else if (line.sourceType === "SAMPLE_MATERIALS" && line.sampleVersionId) {
      const rows = sampleMaterialsByVersionId.get(line.sampleVersionId) ?? [];
      snapshotExplosionItems = rows.map((m) => ({
        materialId: m.materialId,
        // Same distinction resolveExplosionItemsForOrderItem's own sample
        // branch documents — SampleMaterial.colorId is the material's own
        // shade, never a garment-color filter, so it always maps to
        // materialColorId, never colorId.
        colorId: null,
        materialColorId: m.colorId,
        dyeId: m.dyeId,
        quantityPerUnit: Number(m.plannedQuantity),
        wastagePercentage: 0,
        uom: m.uom,
        material: {
          styleName: m.material.styleName,
          styleCode: m.material.styleCode,
          baseUom: m.material.baseUom,
          defaultSupplierId: m.material.defaultSupplierId,
          unitCost: m.material.unitCost,
        },
      }));
    }

    const activeOverrides: ResolvedSalesOrderLineOverride[] = line.overrides.map((o) => {
      const material = o.effectiveMaterialId ? materialById.get(o.effectiveMaterialId) : undefined;
      return {
        originalMaterialId: o.originalMaterialId,
        effectiveMaterial: material
          ? {
              materialId: material.id,
              styleName: material.styleName,
              styleCode: material.styleCode,
              baseUom: material.baseUom,
              defaultSupplierId: material.defaultSupplierId,
              unitCost: material.unitCost,
            }
          : null,
        effectiveQuantityPerUnit: o.effectiveQuantityPerUnit === null ? null : Number(o.effectiveQuantityPerUnit),
        wastagePercentage: o.wastagePercentage === null ? null : Number(o.wastagePercentage),
        colorId: o.colorId,
        effectiveUom: o.uomId ? (uomById.get(o.uomId) ?? null) : null,
      };
    });

    result.set(line.id, { id: line.id, sourceType: line.sourceType, snapshotExplosionItems, activeOverrides });
  }

  return result;
}

/**
 * Applies one line's own frozen snapshot (if it has one) in place of the
 * caller's live-resolved base, then layers any ACTIVE overrides on top —
 * the actual "Effective BOM" the spec describes. A line with no snapshot at
 * all (undefined — the caller never fetched one, or this order item has no
 * salesOrderLineId) falls straight through to `base` unchanged.
 */
export function applyEffectiveBomResolution(
  base: { explosionItems: ExplosionLineItem[]; emptySourceReason: string },
  line: SalesOrderLineSnapshot | undefined
): { explosionItems: ExplosionLineItem[]; emptySourceReason: string } {
  if (!line) return base;

  let explosionItems = line.snapshotExplosionItems ?? base.explosionItems;
  let emptySourceReason = line.snapshotExplosionItems
    ? line.sourceType === "SAMPLE_MATERIALS"
      ? "the linked sample's captured version has no materials recorded"
      : "the captured BOM version has no materials"
    : base.emptySourceReason;

  if (line.activeOverrides.length > 0) {
    explosionItems = applyBomOverrides(explosionItems, line.activeOverrides);
    if (explosionItems.length === 0) emptySourceReason = "every material was removed by a Sales Order override";
  }

  return { explosionItems, emptySourceReason };
}

/**
 * The actual Replace/Add/Remove/Quantity-or-wastage-only application, per
 * SalesOrderBomOverride's nullable-pair shape:
 *   originalMaterialId null, effectiveMaterial set   -> pure addition
 *   effectiveMaterial null                           -> removal
 *   both set, different materialId                   -> replace
 *   both set, same materialId                         -> quantity/wastage/
 *                                                        uom-only adjustment
 * Matching against the base list is by materialId (+ colorId when the
 * override itself specifies one, to disambiguate a style with more than one
 * line for the same material in different colors).
 */
function applyBomOverrides(items: ExplosionLineItem[], overrides: ResolvedSalesOrderLineOverride[]): ExplosionLineItem[] {
  const result = [...items];

  for (const override of overrides) {
    if (override.originalMaterialId === null) {
      // Pure addition — a brand-new line the base BOM/Sample never had.
      if (!override.effectiveMaterial) continue; // the target material no longer resolves — nothing safe to add
      result.push({
        materialId: override.effectiveMaterial.materialId,
        colorId: override.colorId,
        quantityPerUnit: override.effectiveQuantityPerUnit ?? 0,
        wastagePercentage: override.wastagePercentage ?? 0,
        uom: override.effectiveUom,
        material: {
          styleName: override.effectiveMaterial.styleName,
          styleCode: override.effectiveMaterial.styleCode,
          baseUom: override.effectiveMaterial.baseUom,
          defaultSupplierId: override.effectiveMaterial.defaultSupplierId,
          unitCost: override.effectiveMaterial.unitCost,
        },
      });
      continue;
    }

    const matchIndex = result.findIndex(
      (item) => item.materialId === override.originalMaterialId && (!override.colorId || item.colorId === override.colorId)
    );
    if (matchIndex === -1) continue; // the original line this override targeted no longer exists in the base — nothing to change

    if (override.effectiveMaterial === null) {
      // Removal.
      result.splice(matchIndex, 1);
      continue;
    }

    const existing = result[matchIndex];
    if (override.effectiveMaterial.materialId !== override.originalMaterialId) {
      // Replace with a different material.
      result[matchIndex] = {
        materialId: override.effectiveMaterial.materialId,
        colorId: override.colorId ?? existing.colorId,
        quantityPerUnit: override.effectiveQuantityPerUnit ?? existing.quantityPerUnit,
        wastagePercentage: override.wastagePercentage ?? existing.wastagePercentage,
        uom: override.effectiveUom ?? existing.uom,
        material: {
          styleName: override.effectiveMaterial.styleName,
          styleCode: override.effectiveMaterial.styleCode,
          baseUom: override.effectiveMaterial.baseUom,
          defaultSupplierId: override.effectiveMaterial.defaultSupplierId,
          unitCost: override.effectiveMaterial.unitCost,
        },
      };
    } else {
      // Same material — a quantity/wastage/uom-only adjustment.
      result[matchIndex] = {
        ...existing,
        colorId: override.colorId ?? existing.colorId,
        quantityPerUnit: override.effectiveQuantityPerUnit ?? existing.quantityPerUnit,
        wastagePercentage: override.wastagePercentage ?? existing.wastagePercentage,
        uom: override.effectiveUom ?? existing.uom,
      };
    }
  }

  return result;
}

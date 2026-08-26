import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import { round2 } from "@/lib/money";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import type { Prisma } from "@prisma/client";
import type { BomInput } from "./bom.schema";
import { BomRepository } from "./bom.repository";
import { round4 } from "./mrp.service";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listStylesWithBom(companyId: string, query: ListQuery) {
  const where: Prisma.ProductWhereInput = {
    companyId,
    itemType: "STYLE",
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { styleName: { contains: query.search, mode: "insensitive" as const } },
            { styleCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, totalCount] = await Promise.all([
    BomRepository.findStylesWithBomStatus(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    BomRepository.countStyles(where),
  ]);

  // Deliberately a narrow DTO, not the full Product row — DataTable
  // auto-renders an Active/Inactive toggle for any row with an `isActive`
  // field, PATCHing `${fetchUrl}/:id/status`, which has no meaning (and no
  // route) here; style activation belongs to Masters -> Products only.
  const data = rows.map((row) => ({
    id: row.id,
    styleName: row.styleName,
    styleCode: row.styleCode,
    bomItemCount: row.bom?._count.items ?? 0,
  }));
  return { data, totalCount };
}

export async function getBomByProductId(companyId: string, productId: string) {
  const product = await ProductRepository.findStyleById(companyId, productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });

  const bom = await BomRepository.findByProductId(companyId, productId);
  return { product, bom };
}

/**
 * Full replace-items upsert — a BOM is a mutable spec, not a versioned
 * document (see the schema comment on the Bom model), so editing it always
 * replaces the whole item list rather than diffing individual lines.
 */
export async function upsertBom(actor: ActorContext, productId: string, input: BomInput) {
  // Tenant-scope check on the Style itself — do not skip this the way it
  // was skipped once already this project (Sampling's addSampleMaterial,
  // then 26 more update* functions — see CLAUDE.md's 2026-08-19 notes).
  const product = await ProductRepository.findStyleById(actor.companyId, productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });

  // Duplicate/overlap validation: two lines for the same (materialId,
  // colorId) pair, or a "applies to every color" (colorId: null) line
  // coexisting with a specific-color line for the same material — both
  // would silently double-count that material/color's consumption in the
  // MRP calculation.
  const seenByMaterial = new Map<string, { hasNullColor: boolean; colorIds: Set<string> }>();
  for (const item of input.items) {
    const colorId = item.colorId || null;
    const entry = seenByMaterial.get(item.materialId) ?? { hasNullColor: false, colorIds: new Set<string>() };

    if (colorId === null) {
      // Two distinct conflicts, two distinct messages — previously both hit
      // the "all-colors + specific-color" message even when no specific-
      // color line was involved at all, which described a conflict that
      // hadn't actually happened for the genuine "two all-colors lines"
      // case (ERP-BUG-Q3, Phase 10 QA pass).
      if (entry.hasNullColor) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "This material already has an \"applies to every color\" line — edit the existing line's quantity instead.",
          { materialId: item.materialId }
        );
      }
      if (entry.colorIds.size > 0) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A material can't have both an \"applies to every color\" line and a specific-color line — they'd double-count that color's consumption.",
          { materialId: item.materialId }
        );
      }
      entry.hasNullColor = true;
    } else {
      if (entry.hasNullColor) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A material can't have both an \"applies to every color\" line and a specific-color line — they'd double-count that color's consumption.",
          { materialId: item.materialId }
        );
      }
      if (entry.colorIds.has(colorId)) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "This material already has a line for this color — edit the existing line's quantity instead.",
          { materialId: item.materialId, colorId }
        );
      }
      entry.colorIds.add(colorId);
    }
    seenByMaterial.set(item.materialId, entry);
  }

  // Per-item validation: material exists in this company, is a raw
  // material, has a base UOM configured, and the chosen uomId actually
  // converts to it; color (if given) belongs to this company.
  const preparedItems = [];
  for (const item of input.items) {
    const material = await ProductRepository.findMaterialById(actor.companyId, item.materialId);
    if (!material) throw new BusinessRuleError("NOT_FOUND", "Raw material not found.", { id: item.materialId });

    if (!material.baseUom) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${material.styleName}" has no base unit configured — set one in Masters → Materials first.`,
        { materialId: item.materialId }
      );
    }

    const uom = await LookupRepository.unit.findUnique({ where: { id: item.uomId } });
    if (!uom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: item.uomId });

    if (convertUomQuantity(1, uom, material.baseUom) === null) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${uom.name}" has no fixed conversion to "${material.styleName}"'s base unit ("${material.baseUom.name}").`,
        { materialId: item.materialId, uomId: item.uomId }
      );
    }

    if (item.colorId) {
      const color = await LookupRepository.color.findFirst({ where: { id: item.colorId, companyId: actor.companyId } });
      if (!color) throw new BusinessRuleError("NOT_FOUND", "Color not found.", { id: item.colorId });
    }

    preparedItems.push({
      materialId: item.materialId,
      colorId: item.colorId || null,
      quantityPerUnit: item.quantityPerUnit,
      wastagePercentage: item.wastagePercentage,
      uomId: item.uomId,
      notes: item.notes || null,
    });
  }

  const before = await BomRepository.findByProductId(actor.companyId, productId);

  const updated = await BomRepository.upsertWithItems(actor.companyId, productId, input.notes || null, preparedItems);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "boms",
    recordId: updated.id,
    action: before ? "UPDATE" : "CREATE",
    oldValues: before ? { itemCount: before.items.length } : null,
    newValues: { itemCount: updated.items.length },
  });

  return updated;
}

export interface BomCostSheetLine {
  materialId: string;
  materialName: string;
  materialCode: string;
  colorId: string | null;
  colorName: string | null;
  quantityPerUnit: number;
  wastagePercentage: number;
  /** Effective quantity per one finished piece, in the material's own base UOM, after wastage. */
  effectiveQuantity: number;
  uomCode: string;
  /** Per the material's base UOM — null if the material has no unit cost configured. */
  unitCost: number | null;
  /** Null whenever unitCost is unset or this line's UOM has no fixed conversion to the material's base UOM. */
  lineCost: number | null;
  isCostAvailable: boolean;
}

export interface BomCostSheetColorBreakdown {
  colorId: string | null;
  /** "All Colors" for the null-color bucket. */
  colorName: string;
  materialCostPerUnit: number;
  /** False if any line contributing to this bucket lacked cost data — materialCostPerUnit is then a known undercount, not a true total. */
  isComplete: boolean;
}

export interface BomCostSheet {
  productId: string;
  styleName: string;
  styleCode: string;
  hasBom: boolean;
  lines: BomCostSheetLine[];
  /**
   * One entry per color that actually has a color-specific BOM line (each
   * including the always-applicable null-color lines' cost added in), or a
   * single "All Colors" entry when the BOM has no color-specific lines at
   * all. A BomItem's colorId means "this line only applies to that color"
   * (see bom.schema.ts) — so naively summing every line regardless of color
   * would double-count a style that has, say, a Navy-thread line and a
   * separate Black-thread line, as if a single garment needed both.
   */
  colorBreakdown: BomCostSheetColorBreakdown[];
}

/**
 * Material Cost roll-up for a Style's BOM — the first, foundational slice of
 * the BOM Cost Sheet (Processing Cost/Labour Cost/Overhead are tracked
 * nowhere in this schema yet; see docs/FASHION_ERP_FEATURE_ROADMAP.md Step 9
 * for the follow-up plan). Reuses the exact effective-quantity formula and
 * UOM-conversion helper already proven in mrp.service.ts's own material-
 * requirement calculation, rather than a second, divergent implementation —
 * this is what makes the reported cost correct even when a BOM line's unit
 * differs from the material's own base unit (e.g. a line entered in Yards
 * against a Meter-based material).
 */
export async function getBomCostSheet(companyId: string, productId: string): Promise<BomCostSheet> {
  const product = await ProductRepository.findStyleById(companyId, productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });

  const bom = await BomRepository.findByProductId(companyId, productId);
  if (!bom || bom.items.length === 0) {
    return { productId, styleName: product.styleName, styleCode: product.styleCode, hasBom: false, lines: [], colorBreakdown: [] };
  }

  const lines: BomCostSheetLine[] = bom.items.map((item) => {
    const quantityPerUnit = Number(item.quantityPerUnit);
    const wastagePercentage = Number(item.wastagePercentage);
    const effectiveQtyInLineUom = quantityPerUnit * (1 + wastagePercentage / 100);
    const material = item.material;
    const unitCost = material.unitCost !== null ? Number(material.unitCost) : null;

    const effectiveQtyInBaseUom = material.baseUom ? convertUomQuantity(effectiveQtyInLineUom, item.uom, material.baseUom) : null;
    const isCostAvailable = effectiveQtyInBaseUom !== null && unitCost !== null;

    return {
      materialId: material.id,
      materialName: material.styleName,
      materialCode: material.styleCode,
      colorId: item.colorId,
      colorName: item.color?.name ?? null,
      quantityPerUnit,
      wastagePercentage,
      effectiveQuantity: round4(effectiveQtyInBaseUom ?? effectiveQtyInLineUom),
      uomCode: material.baseUom?.code ?? item.uom.code,
      unitCost,
      lineCost: isCostAvailable ? round2(effectiveQtyInBaseUom! * unitCost!) : null,
      isCostAvailable,
    };
  });

  const nullColorLines = lines.filter((l) => l.colorId === null);
  const distinctColors = new Map<string, string>();
  for (const item of bom.items) {
    if (item.colorId && item.color) distinctColors.set(item.colorId, item.color.name);
  }

  function sumBucket(bucketLines: BomCostSheetLine[]): { materialCostPerUnit: number; isComplete: boolean } {
    let sum = 0;
    let isComplete = true;
    for (const line of bucketLines) {
      if (!line.isCostAvailable) {
        isComplete = false;
        continue;
      }
      sum += line.lineCost!;
    }
    return { materialCostPerUnit: round2(sum), isComplete };
  }

  const colorBreakdown: BomCostSheetColorBreakdown[] =
    distinctColors.size === 0
      ? [{ colorId: null, colorName: "All Colors", ...sumBucket(nullColorLines) }]
      : [...distinctColors.entries()].map(([colorId, colorName]) => ({
          colorId,
          colorName,
          ...sumBucket([...nullColorLines, ...lines.filter((l) => l.colorId === colorId)]),
        }));

  return { productId, styleName: product.styleName, styleCode: product.styleCode, hasBom: true, lines, colorBreakdown };
}

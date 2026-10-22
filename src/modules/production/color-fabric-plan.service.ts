import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { getEffectiveExplosionItemsForOrderLine } from "@/modules/bom-mrp/mrp.service";
import { ProductRepository } from "@/modules/products/product.repository";
import { ProductionOrderRepository } from "./production.repository";
import type { SaveColorFabricPlanInput } from "./production.schema";

/**
 * Production Order colour-wise fabric plan (2026-10-21).
 *
 * For every garment colour on the linked Sales Order line ("Quantity by Color
 * / Size") and every fabric line of the order's Effective BOM, the planner
 * picks which fabric to issue (defaults to the BOM's fabric), which fabric
 * colour, and how much. "Request Material" is blocked until every row has a
 * fabric colour, and the fabric lines of the generated Material Request come
 * from these rows instead of the BOM's colour-less fabric total.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

const EPSILON = 0.0001;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface ColorFabricPlanRow {
  garmentColorId: string;
  garmentColorName: string;
  /** This colour's share of the production order's planned pieces. */
  pieces: number;
  bomMaterialId: string;
  bomMaterialName: string;
  bomMaterialCode: string;
  /** BOM consumption per piece (incl. wastage), in the BOM fabric's base unit. */
  perPieceQuantity: number;
  uomId: string;
  uomCode: string;
  /** perPieceQuantity x pieces — the default issue quantity. */
  suggestedQuantity: number;
  saved: {
    materialId: string;
    materialName: string;
    materialCode: string;
    fabricColorId: string | null;
    fabricColorName: string | null;
    quantity: number;
    uomId: string;
    uomCode: string;
  } | null;
  isComplete: boolean;
}

export interface ColorFabricPlan {
  /** False when the order has no colour breakdown or its BOM has no fabric — the gate doesn't apply. */
  applies: boolean;
  reason: string | null;
  rows: ColorFabricPlanRow[];
  isComplete: boolean;
  /** Garment colours that still need a fabric colour (for messages). */
  incompleteColors: string[];
}

export async function getColorFabricPlan(companyId: string, productionOrderId: string): Promise<ColorFabricPlan> {
  const order = await ProductionOrderRepository.findAnyById(companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });

  const notApplicable = (reason: string): ColorFabricPlan => ({ applies: false, reason, rows: [], isComplete: true, incompleteColors: [] });

  if (!order.salesOrderItemId) {
    return notApplicable("This is a make-to-stock order with no Sales Order colour breakdown.");
  }

  const breakdown = await prisma.salesOrderItemBreakdown.findMany({
    where: { salesOrderItemId: order.salesOrderItemId, salesOrderItem: { salesOrder: { companyId } } },
    select: { orderedQuantity: true, productVariant: { select: { color: { select: { id: true, name: true } } } } },
  });
  const colorQty = new Map<string, { name: string; quantity: number }>();
  for (const b of breakdown) {
    const color = b.productVariant.color;
    const entry = colorQty.get(color.id) ?? { name: color.name, quantity: 0 };
    entry.quantity += Number(b.orderedQuantity);
    colorQty.set(color.id, entry);
  }
  const salesOrderTotal = Array.from(colorQty.values()).reduce((sum, c) => sum + c.quantity, 0);
  if (salesOrderTotal <= 0) return notApplicable("The Sales Order line has no colour/size quantities.");

  const items = await getEffectiveExplosionItemsForOrderLine(companyId, { salesOrderItemId: order.salesOrderItemId, productId: order.productId });
  const categories = await prisma.product.findMany({
    where: { companyId, id: { in: Array.from(new Set(items.map((i) => i.materialId))) } },
    select: { id: true, materialCategory: true },
  });
  const fabricIds = new Set(categories.filter((c) => c.materialCategory === "FABRIC").map((c) => c.id));
  const fabricItems = items.filter((i) => fabricIds.has(i.materialId) && i.uom && i.material.baseUom);
  if (fabricItems.length === 0) return notApplicable("The BOM has no fabric lines.");

  // A production order may plan a different total than its Sales Order line —
  // each colour gets its proportional share of the planned pieces.
  const ratio = Number(order.plannedQuantity) / salesOrderTotal;

  const saved = await prisma.productionOrderColorFabric.findMany({
    where: { companyId, productionOrderId },
    include: {
      material: { select: { styleName: true, styleCode: true } },
      fabricColor: { select: { name: true } },
      uom: { select: { code: true } },
    },
  });
  const savedByKey = new Map(saved.map((s) => [`${s.garmentColorId}:${s.bomMaterialId}`, s]));

  const rows: ColorFabricPlanRow[] = [];
  for (const [garmentColorId, color] of colorQty) {
    // A BOM line scoped to one garment colour only applies to that colour.
    const perMaterial = new Map<string, { item: (typeof fabricItems)[number]; perPiece: number }>();
    for (const item of fabricItems) {
      if (item.colorId && item.colorId !== garmentColorId) continue;
      const base = item.material.baseUom!;
      const perPiece = convertUomQuantity(item.quantityPerUnit * (1 + item.wastagePercentage / 100), item.uom!, base);
      if (perPiece === null) continue;
      const entry = perMaterial.get(item.materialId) ?? { item, perPiece: 0 };
      entry.perPiece += perPiece;
      perMaterial.set(item.materialId, entry);
    }
    const pieces = round4(color.quantity * ratio);
    for (const [bomMaterialId, { item, perPiece }] of perMaterial) {
      const s = savedByKey.get(`${garmentColorId}:${bomMaterialId}`);
      const savedRow = s
        ? {
            materialId: s.materialId,
            materialName: s.material.styleName,
            materialCode: s.material.styleCode,
            fabricColorId: s.fabricColorId,
            fabricColorName: s.fabricColor?.name ?? null,
            quantity: Number(s.quantity),
            uomId: s.uomId,
            uomCode: s.uom.code,
          }
        : null;
      rows.push({
        garmentColorId,
        garmentColorName: color.name,
        pieces,
        bomMaterialId,
        bomMaterialName: item.material.styleName,
        bomMaterialCode: item.material.styleCode,
        perPieceQuantity: round4(perPiece),
        uomId: item.material.baseUom!.id,
        uomCode: item.material.baseUom!.code,
        suggestedQuantity: round4(perPiece * pieces),
        saved: savedRow,
        isComplete: !!savedRow && !!savedRow.fabricColorId && savedRow.quantity > EPSILON,
      });
    }
  }
  rows.sort((a, b) => a.garmentColorName.localeCompare(b.garmentColorName) || a.bomMaterialName.localeCompare(b.bomMaterialName));

  const incompleteColors = Array.from(new Set(rows.filter((r) => !r.isComplete).map((r) => r.garmentColorName)));
  return { applies: rows.length > 0, reason: rows.length > 0 ? null : "No fabric applies to the ordered colours.", rows, isComplete: incompleteColors.length === 0, incompleteColors };
}

export async function saveColorFabricPlan(actor: ActorContext, productionOrderId: string, input: SaveColorFabricPlanInput) {
  const plan = await getColorFabricPlan(actor.companyId, productionOrderId);
  if (!plan.applies) {
    throw new BusinessRuleError("VALIDATION_ERROR", plan.reason ?? "No colour-wise fabric plan applies to this order.", {});
  }
  const rowKeys = new Set(plan.rows.map((r) => `${r.garmentColorId}:${r.bomMaterialId}`));

  const materialIds = Array.from(new Set(input.rows.map((r) => r.materialId)));
  const colorIds = Array.from(new Set(input.rows.map((r) => r.fabricColorId).filter((id): id is string => !!id)));
  const uomIds = Array.from(new Set(input.rows.map((r) => r.uomId)));
  const [materials, colors, uoms] = await Promise.all([
    Promise.all(materialIds.map((id) => ProductRepository.findMaterialById(actor.companyId, id))),
    prisma.color.findMany({ where: { companyId: actor.companyId, id: { in: colorIds } }, select: { id: true } }),
    prisma.unitOfMeasure.findMany({ where: { id: { in: uomIds } }, select: { id: true } }),
  ]);
  if (materials.some((m) => !m)) throw new BusinessRuleError("NOT_FOUND", "A selected fabric was not found.", { materialIds });
  if (colors.length !== colorIds.length) throw new BusinessRuleError("NOT_FOUND", "A selected fabric colour was not found.", { colorIds });
  if (uoms.length !== uomIds.length) throw new BusinessRuleError("NOT_FOUND", "A selected unit was not found.", { uomIds });

  for (const row of input.rows) {
    if (!rowKeys.has(`${row.garmentColorId}:${row.bomMaterialId}`)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "A row doesn't match this order's garment colours and BOM fabrics — reload and try again.", {
        garmentColorId: row.garmentColorId,
        bomMaterialId: row.bomMaterialId,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const row of input.rows) {
      const data = {
        materialId: row.materialId,
        fabricColorId: row.fabricColorId || null,
        quantity: row.quantity,
        uomId: row.uomId,
        updatedByUserId: actor.userId,
      };
      await tx.productionOrderColorFabric.upsert({
        where: {
          productionOrderId_garmentColorId_bomMaterialId: {
            productionOrderId,
            garmentColorId: row.garmentColorId,
            bomMaterialId: row.bomMaterialId,
          },
        },
        create: { companyId: actor.companyId, productionOrderId, garmentColorId: row.garmentColorId, bomMaterialId: row.bomMaterialId, ...data },
        update: data,
      });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_order_color_fabrics",
    recordId: productionOrderId,
    action: "UPDATE",
    newValues: { rows: input.rows },
  });

  return getColorFabricPlan(actor.companyId, productionOrderId);
}

/**
 * The Material Request lines for the plan's fabric: one line per chosen
 * fabric x fabric colour, in the fabric's base unit, minus what this order
 * has already requested of that fabric in that colour. A request of the same
 * fabric made with no colour (e.g. before the plan existed) also counts — it's
 * used up across that fabric's colour lines in turn, so fabric is never
 * requested twice. `alreadyRequested` is keyed `${materialId}:${colorId}`,
 * with "null" for no colour. Throws when any garment colour is still missing
 * its fabric colour.
 */
export async function buildFabricRequestLines(
  companyId: string,
  plan: ColorFabricPlan,
  alreadyRequested: Map<string, number>
): Promise<Array<{ materialId: string; colorId: string; uomId: string; requestedQuantity: number }>> {
  if (!plan.isComplete) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Select the fabric and fabric colour for every garment colour before requesting material (missing: ${plan.incompleteColors.join(", ")}).`,
      { incompleteColors: plan.incompleteColors }
    );
  }
  const materialIds = Array.from(new Set(plan.rows.map((r) => r.saved!.materialId)));
  const uomIds = Array.from(new Set(plan.rows.map((r) => r.saved!.uomId)));
  const [materials, uoms] = await Promise.all([
    prisma.product.findMany({
      where: { companyId, id: { in: materialIds } },
      select: { id: true, styleName: true, baseUom: { select: { id: true, baseUnitId: true, conversionFactor: true } } },
    }),
    prisma.unitOfMeasure.findMany({ where: { id: { in: uomIds } }, select: { id: true, baseUnitId: true, conversionFactor: true } }),
  ]);
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const uomById = new Map(uoms.map((u) => [u.id, u]));

  const totals = new Map<string, { materialId: string; colorId: string; uomId: string; quantity: number }>();
  for (const row of plan.rows) {
    const s = row.saved!;
    const material = materialById.get(s.materialId);
    const base = material?.baseUom;
    if (!material || !base) {
      throw new BusinessRuleError("UOM_CONVERSION_UNAVAILABLE", `"${s.materialName}" has no base unit configured.`, { materialId: s.materialId });
    }
    const from = uomById.get(s.uomId);
    const quantity = from ? convertUomQuantity(s.quantity, from, base) : null;
    if (quantity === null) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `The unit chosen for ${s.materialName} (${row.garmentColorName}) has no fixed conversion to its base unit.`,
        { materialId: s.materialId }
      );
    }
    const key = `${s.materialId}:${s.fabricColorId}`;
    const entry = totals.get(key) ?? { materialId: s.materialId, colorId: s.fabricColorId!, uomId: base.id, quantity: 0 };
    entry.quantity += quantity;
    totals.set(key, entry);
  }

  const colorlessLeft = new Map<string, number>();
  for (const t of totals.values()) {
    if (!colorlessLeft.has(t.materialId)) colorlessLeft.set(t.materialId, alreadyRequested.get(`${t.materialId}:null`) ?? 0);
  }
  return Array.from(totals.entries())
    .map(([key, t]) => {
      let remaining = Math.max(0, t.quantity - (alreadyRequested.get(key) ?? 0));
      const colorless = colorlessLeft.get(t.materialId) ?? 0;
      const used = Math.min(colorless, remaining);
      colorlessLeft.set(t.materialId, colorless - used);
      remaining -= used;
      return { materialId: t.materialId, colorId: t.colorId, uomId: t.uomId, requestedQuantity: round4(remaining) };
    })
    .filter((l) => l.requestedQuantity > EPSILON);
}

/**
 * Lot material gate support: a fabric chosen in the plan instead of the BOM's
 * own fabric stands in for it, so its issued quantity counts toward the BOM
 * fabric. Returns chosen material -> BOM material, for chosen materials that
 * aren't themselves a BOM material.
 */
export async function getPlanFabricReplacements(companyId: string, productionOrderId: string): Promise<Map<string, string>> {
  const rows = await prisma.productionOrderColorFabric.findMany({
    where: { companyId, productionOrderId },
    select: { materialId: true, bomMaterialId: true },
  });
  const bomMaterialIds = new Set(rows.map((r) => r.bomMaterialId));
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.materialId !== r.bomMaterialId && !bomMaterialIds.has(r.materialId)) map.set(r.materialId, r.bomMaterialId);
  }
  return map;
}

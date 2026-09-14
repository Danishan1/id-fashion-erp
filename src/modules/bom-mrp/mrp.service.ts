import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { sumAvailableByProductIds } from "@/modules/inventory/inventory.service";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { SampleMaterialRepository } from "@/modules/sampling/sample.repository";
import { BomRepository } from "./bom.repository";

// Every quantity here accumulates through repeated floating-point addition
// (contributingStyles across multiple BOM lines/order items), which
// otherwise surfaces IEEE-754 noise like 103.60000000000002 in the JSON
// response. Rounds to the same 4-decimal precision this project's own
// Decimal(18,4) quantity columns already use everywhere else.
export function round4(n: number): number {
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
  /** Already issued via a non-cancelled Material Request linked to this Sales Order, in the material's own base UOM. */
  issuedQuantity: number;
  shortfallQuantity: number;
  defaultSupplierId: string | null;
  unitCost: number | null;
  contributingStyles: ContributingStyle[];
}

/** A "unit of measure" shape narrow enough for convertUomQuantity — shared
 * by both a real BomItem's own uom/material.baseUom and a SampleMaterial's
 * (nullable) uom/material.baseUom, so one explosion loop works for either
 * source. */
interface RequirementUom {
  id: string;
  code: string;
  name: string;
  baseUnitId: string | null;
  conversionFactor: number | string | Prisma.Decimal;
}

/**
 * One material line to explode against an order's breakdown quantity —
 * either a real BomItem (Style's own real BOM) or a SampleMaterial row
 * (a linked Sample's own material list, standing in for a BOM when a Sales
 * Order line has one), normalized to a common shape so the explosion loop
 * below never needs to know which source it came from.
 */
interface ExplosionLineItem {
  materialId: string;
  colorId: string | null;
  quantityPerUnit: number;
  wastagePercentage: number;
  uom: RequirementUom | null;
  material: {
    styleName: string;
    styleCode: string;
    baseUom: RequirementUom | null;
    defaultSupplierId: string | null;
    unitCost: unknown;
  };
}

/**
 * Explodes one order item's material lines (from either source) against its
 * own color/size breakdown and accumulates the result into rowsByMaterialId —
 * the exact per-line math (color-filtered ordered qty, wastage, base-UOM
 * conversion, contributing-style merge) this function used to run inline
 * only for BomItem rows; now shared so a Sample's material list can stand in
 * for the Style's real BOM without a second, diverging copy of this math.
 */
function explodeItemsForOrderItem(
  items: ExplosionLineItem[],
  orderItem: {
    productId: string;
    product: { styleName: string };
    breakdown: Array<{ productVariant: { color: { id: string } }; orderedQuantity: number }>;
  },
  rowsByMaterialId: Map<string, MaterialRequirementRow>,
  unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }>
) {
  for (const item of items) {
    const matchingBreakdown = orderItem.breakdown.filter((b) => !item.colorId || b.productVariant.color.id === item.colorId);
    const orderedQty = matchingBreakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
    if (orderedQty === 0) continue;

    const effectiveQtyInBomUnit = item.quantityPerUnit * (1 + item.wastagePercentage / 100) * orderedQty;

    if (!item.uom) {
      unconvertibleLines.push({ materialId: item.materialId, materialName: item.material.styleName, reason: "no unit specified" });
      continue;
    }
    if (!item.material.baseUom) {
      unconvertibleLines.push({ materialId: item.materialId, materialName: item.material.styleName, reason: "no base unit configured" });
      continue;
    }

    const neededInBaseUom = convertUomQuantity(effectiveQtyInBomUnit, item.uom, item.material.baseUom);
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
      // Merge into an already-listed style rather than pushing a second
      // entry — a style can reach this material through more than one
      // material line (e.g. two different color-specific lines), and
      // without this it appeared twice with a partial quantity each,
      // instead of once with the correct total.
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
      rowsByMaterialId.set(item.materialId, {
        materialId: item.materialId,
        materialName: item.material.styleName,
        materialCode: item.material.styleCode,
        uomId: item.material.baseUom.id,
        uomCode: item.material.baseUom.code,
        neededQuantity: neededInBaseUom,
        availableQuantity: 0,
        issuedQuantity: 0,
        shortfallQuantity: 0,
        defaultSupplierId: item.material.defaultSupplierId,
        unitCost: item.material.unitCost ? Number(item.material.unitCost) : null,
        contributingStyles: [{ productId: orderItem.productId, styleName: orderItem.product.styleName, neededQuantity: neededInBaseUom }],
      });
    }
  }
}

/** The narrow order-item shape explodeOrderItemsToRows/explodeItemsForOrderItem actually need — satisfied by both SalesOrderRepository.findByIdWithDetails's richer items and the lighter select used by getSalesOrdersMaterialStatus's batch query. */
interface OrderItemForExplosion {
  productId: string;
  product: { styleName: string };
  sampleRequestId: string | null;
  breakdown: Array<{ productVariant: { color: { id: string } }; orderedQuantity: number }>;
}

/**
 * Shared per-order explosion: given one order's items plus the already
 * batch-fetched BOM/Sample-material lookups, returns needed-quantity-per-
 * material (rowsByMaterialId) — the same math getMaterialRequirements and
 * getSalesOrdersMaterialStatus both need, kept in exactly one place so a
 * "needed" figure shown on one screen can never quietly disagree with what
 * drives the other.
 */
function explodeOrderItemsToRows(
  items: OrderItemForExplosion[],
  bomByProductId: Map<string, Awaited<ReturnType<typeof BomRepository.findManyByProductIds>>[number]>,
  sampleMaterialsById: Map<string, Awaited<ReturnType<typeof SampleMaterialRepository.findLatestVersionMaterialsForRequirement>>>
) {
  const stylesWithoutBom: Array<{ productId: string; styleName: string; reason: string }> = [];
  const rowsByMaterialId = new Map<string, MaterialRequirementRow>();
  const unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }> = [];

  for (const orderItem of items) {
    let explosionItems: ExplosionLineItem[];
    let emptySourceReason: string;

    if (orderItem.sampleRequestId) {
      const sampleMaterials = sampleMaterialsById.get(orderItem.sampleRequestId) ?? [];
      explosionItems = sampleMaterials.map((m) => ({
        materialId: m.materialId,
        // SampleMaterial.colorId means "this raw material's own shade/dye"
        // (e.g. thread color) -- an entirely different concept from
        // BomItem.colorId ("this line only applies to this ordered
        // garment-color variant"), which is what
        // explodeItemsForOrderItem's own filter below actually implements.
        // Passing the sample's shade through as colorId would silently
        // filter this line's orderedQty to 0 (the shade id essentially
        // never matches a real style-variant color id), dropping the whole
        // line with zero error reported. Always null here so the full
        // ordered quantity applies regardless of the sample material's own
        // shade color.
        colorId: null,
        quantityPerUnit: Number(m.plannedQuantity),
        // SampleMaterial has no wastage% column — the sample's own recorded
        // quantity is treated as the effective (already-wastage-inclusive)
        // per-unit consumption, a deliberate MVP simplification.
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
      emptySourceReason = "the linked sample has no materials recorded yet";
    } else {
      const bom = bomByProductId.get(orderItem.productId);
      // An unapproved draft (or no BOM at all) is treated identically —
      // material planning must never silently consume an edit-in-progress
      // that no one has signed off on yet (see docs/PRACTICAL_BUSINESS_READY_
      // AUDIT.md Section 4 — this is the real gate that was missing before).
      const approvedItems = bom?.approvedVersion?.items ?? [];
      explosionItems = approvedItems.map((item) => ({
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
      emptySourceReason = "no BOM defined for this style";
    }

    if (explosionItems.length === 0) {
      stylesWithoutBom.push({ productId: orderItem.productId, styleName: orderItem.product.styleName, reason: emptySourceReason });
      continue;
    }

    explodeItemsForOrderItem(explosionItems, orderItem, rowsByMaterialId, unconvertibleLines);
  }

  return { rowsByMaterialId, stylesWithoutBom, unconvertibleLines };
}

// Same tolerance idiom already used for quantity comparisons elsewhere in
// this codebase (inventory.service.ts, job-order.service.ts) — avoids a
// false "still pending" flag from pure floating-point noise.
const QUANTITY_EPSILON = 0.0001;

/**
 * { salesOrderId -> { materialId -> issuedQuantity } }, in each material's
 * own base UOM — total already-issued-so-far across every non-cancelled
 * Material Request linked to each Sales Order. A request line is raised in
 * whatever unit was chosen at the time (not necessarily the material's base
 * unit), so each line is converted individually before summing, the same
 * convertUomQuantity discipline every other quantity in this module already
 * follows. A line whose unit can't be converted (no base UOM configured, or
 * no fixed factor) is skipped rather than thrown — matches this function's
 * advisory role; the real conversion gate already lives at Material Request
 * creation time.
 */
async function getIssuedQuantitiesBySalesOrder(companyId: string, salesOrderIds: string[]): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (salesOrderIds.length === 0) return result;

  const items = await prisma.materialRequestItem.findMany({
    where: { materialRequest: { companyId, salesOrderId: { in: salesOrderIds }, status: { not: "CANCELLED" } } },
    select: {
      materialId: true,
      issuedQuantity: true,
      uom: true,
      material: { select: { baseUom: true } },
      materialRequest: { select: { salesOrderId: true } },
    },
  });

  for (const item of items) {
    const salesOrderId = item.materialRequest.salesOrderId;
    if (!salesOrderId || !item.material.baseUom) continue;
    const converted = convertUomQuantity(Number(item.issuedQuantity), item.uom, item.material.baseUom);
    if (converted === null) continue;

    if (!result.has(salesOrderId)) result.set(salesOrderId, new Map());
    const perMaterial = result.get(salesOrderId)!;
    perMaterial.set(item.materialId, (perMaterial.get(item.materialId) ?? 0) + converted);
  }

  return result;
}

/**
 * Computes needed/available/issued/shortfall per material for a Sales
 * Order's style lines. Purely informational — no status restriction, no
 * stock reservation happens here (that's Production's job once a
 * Production Order actually reserves stock). Aggregates by materialId only
 * (never materialId+uomId — a mixed-unit sum would be wrong if the same
 * material is used at different chosen uomIds across different lines);
 * every reported quantity is in the material's own base UOM, converted via
 * convertUomQuantity.
 *
 * `shortfallQuantity` is "Needed − Issued so far" (how much MORE this order
 * still needs raised as a Material Request), not "Needed − current stock" —
 * this page raises requests, it never issues material itself, so the real
 * question it answers is "what hasn't been requested/issued yet for this
 * order", independent of whether stock happens to be sitting in the
 * warehouse right now. `availableQuantity` (current company-wide stock)
 * stays purely informational alongside it.
 *
 * Per-line source resolution, per the user's own explicit rule: a line with
 * a linked Sample (`sampleRequestId` set) explodes that Sample's own current
 * material list instead of the Style's real BOM — a line with no linked
 * Sample uses the Style's real, approved BOM exactly as before. The Style's
 * own Bom/BomItem rows are never written to by this function either way.
 */
export async function getMaterialRequirements(companyId: string, salesOrderId: string) {
  // SalesOrderRepository.findByIdWithDetails is already company-scoped —
  // reuse as-is, do not add a second, unscoped lookup.
  const order = await SalesOrderRepository.findByIdWithDetails(companyId, salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: salesOrderId });

  const styleProductIds = [...new Set(order.items.map((item) => item.productId))];
  const boms = await BomRepository.findManyByProductIds(companyId, styleProductIds);
  const bomByProductId = new Map(boms.map((bom) => [bom.productId, bom]));

  // Sample-linked lines are batch-fetched once per distinct sample, not once
  // per order line — a Sales Order rarely links the same sample to more than
  // one line, but nothing rules it out.
  const sampleRequestIds = [...new Set(order.items.map((item) => item.sampleRequestId).filter((id): id is string => !!id))];
  const sampleMaterialsById = new Map(
    await Promise.all(
      sampleRequestIds.map(
        async (id) => [id, await SampleMaterialRepository.findLatestVersionMaterialsForRequirement(id)] as const
      )
    )
  );

  const { rowsByMaterialId, stylesWithoutBom, unconvertibleLines } = explodeOrderItemsToRows(order.items, bomByProductId, sampleMaterialsById);

  const materialIds = [...rowsByMaterialId.keys()];
  const [availableByMaterialId, issuedBySalesOrder] = await Promise.all([
    sumAvailableByProductIds(companyId, materialIds),
    getIssuedQuantitiesBySalesOrder(companyId, [salesOrderId]),
  ]);
  const issuedByMaterialId = issuedBySalesOrder.get(salesOrderId) ?? new Map<string, number>();

  const materials = [...rowsByMaterialId.values()].map((row) => {
    const availableQuantity = availableByMaterialId.get(row.materialId) ?? 0;
    const issuedQuantity = issuedByMaterialId.get(row.materialId) ?? 0;
    return {
      ...row,
      neededQuantity: round4(row.neededQuantity),
      availableQuantity: round4(availableQuantity),
      issuedQuantity: round4(issuedQuantity),
      shortfallQuantity: round4(Math.max(0, row.neededQuantity - issuedQuantity)),
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

export interface SalesOrderMaterialStatusEntry {
  id: string;
  orderNumber: string;
  customerName: string;
  /** FULFILLED means every exploded material's real shortfall (needed −
   * issued so far) is already zero — never means "nothing left in stock",
   * that's a different, purely informational figure elsewhere on this page.
   * An order with no explodable materials at all (no BOM/Sample anywhere) is
   * reported PENDING, never FULFILLED — there's nothing to say is "done". */
  materialStatus: "PENDING" | "FULFILLED";
}

const PENDING_LIST_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "DISPATCHED", "INVOICED", "ON_HOLD"] as const;

/**
 * Batch pending/fulfilled classification for the Sales Order picker on the
 * Material Requirements page — lets the default view hide orders with
 * nothing left to request without ever losing access to a "fully issued"
 * order a merchandiser still wants to raise MORE material against later
 * (damage, a quantity increase, etc.): FULFILLED orders are filtered out of
 * the default list, never deleted or hidden from the "all"/"fulfilled"
 * views. Deliberately skips the company-wide stock lookup
 * (sumAvailableByProductIds) this page's own single-order detail view uses —
 * that figure is purely informational there and isn't needed just to decide
 * pending-vs-fulfilled here, so this stays cheap even across ~200 orders:
 * one query for all candidate orders, one batched BOM/Sample-material
 * fetch, one batched issued-quantity fetch — never N+1 per order.
 */
export async function getSalesOrdersMaterialStatus(companyId: string): Promise<SalesOrderMaterialStatusEntry[]> {
  const orders = await prisma.salesOrder.findMany({
    where: { companyId, status: { in: [...PENDING_LIST_STATUSES] } },
    select: {
      id: true,
      orderNumber: true,
      customer: { select: { name: true } },
      items: {
        select: {
          productId: true,
          product: { select: { styleName: true } },
          sampleRequestId: true,
          breakdown: { select: { orderedQuantity: true, productVariant: { select: { color: { select: { id: true } } } } } },
        },
      },
    },
    orderBy: { orderDate: "desc" },
    take: 200,
  });

  if (orders.length === 0) return [];

  const styleProductIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
  const boms = await BomRepository.findManyByProductIds(companyId, styleProductIds);
  const bomByProductId = new Map(boms.map((bom) => [bom.productId, bom]));

  const sampleRequestIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.sampleRequestId).filter((id): id is string => !!id)))];
  const sampleMaterialsById = new Map(
    await Promise.all(
      sampleRequestIds.map(
        async (id) => [id, await SampleMaterialRepository.findLatestVersionMaterialsForRequirement(id)] as const
      )
    )
  );

  const issuedBySalesOrder = await getIssuedQuantitiesBySalesOrder(companyId, orders.map((o) => o.id));

  return orders.map((order) => {
    const { rowsByMaterialId } = explodeOrderItemsToRows(order.items, bomByProductId, sampleMaterialsById);
    const issuedByMaterialId = issuedBySalesOrder.get(order.id) ?? new Map<string, number>();

    let pending = rowsByMaterialId.size === 0;
    for (const row of rowsByMaterialId.values()) {
      const issued = issuedByMaterialId.get(row.materialId) ?? 0;
      if (row.neededQuantity - issued > QUANTITY_EPSILON) {
        pending = true;
        break;
      }
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customer.name,
      materialStatus: pending ? "PENDING" : "FULFILLED",
    };
  });
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
  /** null for a sample-sourced result (getSampleMaterialRequirement) — that
   * calculation has no single Style driving it. */
  productId: string | null;
  bomId: string | null;
  /** Set only for a sample-sourced result — the sample whose current
   * material list this requirement was exploded from. */
  sampleRequestId: string | null;
  /** True once there's at least one material line to explode — for a
   * sample-sourced result this means "the sample has recorded materials",
   * not "an approved BOM exists" (the name is kept for both cases so every
   * existing caller's `if (!requirement.hasApprovedBom)` guard keeps working
   * unchanged regardless of which source produced the result). */
  hasApprovedBom: boolean;
  materials: StyleMaterialRequirementRow[];
  unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }>;
  /** null if there's no source to explode, any material has no unitCost, or
   * any line couldn't be converted to its base UOM — an undercounted total
   * would be worse than an honest "unavailable". */
  totalMaterialCost: number | null;
  materialCostPerUnit: number | null;
}

/**
 * The shared per-line explosion math behind both getStyleMaterialRequirement
 * and getSampleMaterialRequirement below — given a flat quantity (as opposed
 * to getMaterialRequirements' own color/size breakdown), computes needed/
 * available/shortfall/cost per material from whichever explosion items the
 * caller already resolved (a Style's real BomItem rows, or a Sample's own
 * SampleMaterial rows), properly converted to each material's base UOM
 * before comparing against real stock.
 */
async function explodeFlatQuantity(companyId: string, items: ExplosionLineItem[], quantity: number) {
  const rowsByMaterialId = new Map<
    string,
    { materialName: string; materialCode: string; uomId: string; uomCode: string; neededQuantity: number; unitCost: number | null }
  >();
  const unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }> = [];

  for (const item of items) {
    const effectiveQtyPerUnit = item.quantityPerUnit * (1 + item.wastagePercentage / 100);
    const neededInBomUnit = effectiveQtyPerUnit * quantity;

    if (!item.uom) {
      unconvertibleLines.push({ materialId: item.materialId, materialName: item.material.styleName, reason: "no unit specified" });
      continue;
    }
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
    materials,
    unconvertibleLines,
    totalMaterialCost: allCostsKnown ? round4(totalMaterialCost) : null,
    materialCostPerUnit: allCostsKnown && quantity > 0 ? round4(totalMaterialCost / quantity) : null,
  };
}

/**
 * The single source of truth for "given this style and this quantity, what
 * materials are needed and what would they cost" — the same BOM-explosion
 * math getMaterialRequirements above already uses, just keyed on a flat
 * quantity instead of a Sales Order's own color/size breakdown. Two real
 * callers: the Production Order create/edit form's live preview (quantity =
 * the order's own, freely editable plannedQuantity — can differ from what
 * the linked Sales Order actually ordered) and generateMaterialRequestForOrder
 * in production-order.service.ts.
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
      sampleRequestId: null,
      hasApprovedBom: false,
      materials: [],
      unconvertibleLines: [],
      totalMaterialCost: null,
      materialCostPerUnit: null,
    };
  }

  const explosionItems: ExplosionLineItem[] = approvedItems.map((item) => ({
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

  const result = await explodeFlatQuantity(companyId, explosionItems, quantity);

  return { productId, bomId: bom?.id ?? null, sampleRequestId: null, hasApprovedBom: true, ...result };
}

/**
 * The Sample-sourced twin of getStyleMaterialRequirement above — explodes a
 * linked Sample's own current (highest version number) material list
 * against a flat quantity, using the exact same base-UOM-conversion math.
 * Returns the same StyleMaterialRequirementResult shape (bomId always null,
 * productId always null — there's no Style/BomVersion behind this result) so
 * every existing caller of the Style-sourced function can consume either
 * result identically. Reused by both getMaterialRequirementForOrderLine
 * below and any future direct caller.
 */
export async function getSampleMaterialRequirement(
  companyId: string,
  sampleRequestId: string,
  quantity: number
): Promise<StyleMaterialRequirementResult> {
  const sampleMaterials = await SampleMaterialRepository.findLatestVersionMaterialsForRequirement(sampleRequestId);

  if (sampleMaterials.length === 0) {
    return {
      productId: null,
      bomId: null,
      sampleRequestId,
      hasApprovedBom: false,
      materials: [],
      unconvertibleLines: [],
      totalMaterialCost: null,
      materialCostPerUnit: null,
    };
  }

  const explosionItems: ExplosionLineItem[] = sampleMaterials.map((m) => ({
    materialId: m.materialId,
    colorId: m.colorId,
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

  const result = await explodeFlatQuantity(companyId, explosionItems, quantity);

  return { productId: null, bomId: null, sampleRequestId, hasApprovedBom: true, ...result };
}

/**
 * Resolves which requirement source a Production Order (or its live create/
 * edit-form preview) should use for one Sales Order line, per the user's own
 * explicit rule: the linked Sample's own material list if that line has one,
 * otherwise the Style's own real BOM. The one real caller
 * (generateMaterialRequestForOrder) and the live preview both go through this
 * so a shortfall/cost figure a user sees can never disagree with what
 * "Generate Material Request" actually raises.
 */
export async function getMaterialRequirementForOrderLine(
  companyId: string,
  args: { salesOrderItemId: string | null | undefined; productId: string; quantity: number }
): Promise<StyleMaterialRequirementResult> {
  if (args.salesOrderItemId) {
    const item = await prisma.salesOrderItem.findFirst({
      where: { id: args.salesOrderItemId, salesOrder: { companyId } },
      select: { sampleRequestId: true },
    });
    if (item?.sampleRequestId) {
      return getSampleMaterialRequirement(companyId, item.sampleRequestId, args.quantity);
    }
  }
  return getStyleMaterialRequirement(companyId, args.productId, args.quantity);
}

export interface SalesOrderMaterialPreviewItem {
  salesOrderItemId: string;
  productId: string;
  styleName: string;
  sampleRequestId: string | null;
  sampleStyleName: string | null;
  orderedQuantity: number;
  hasApprovedBom: boolean;
  materials: Array<StyleMaterialRequirementRow & { quantityPerUnit: number }>;
  unconvertibleLines: Array<{ materialId: string; materialName: string; reason: string }>;
  totalMaterialCost: number | null;
  materialCostPerUnit: number | null;
}

export interface SalesOrderMaterialPreview {
  salesOrder: { id: string; orderNumber: string; customerName: string };
  items: SalesOrderMaterialPreviewItem[];
  grandTotalMaterialCost: number | null;
}

/**
 * Per-style-line material breakdown for one Sales Order — the shared engine
 * behind both the Sales Order detail page's "Estimated Material Cost"
 * section and the Material Request create form's "add items from this
 * order's BOM" preview, so neither can ever disagree with the other.
 * Reuses getMaterialRequirementForOrderLine's own BOM-vs-Sample source
 * resolution and cost math unchanged — never a second, diverging copy.
 * `quantityPerUnit` is derived for display only (neededQuantity /
 * orderedQuantity, e.g. "50 x 1.2m = 60m") — not a new calculation, just
 * re-expressing the already-computed total as a per-piece factor.
 */
export async function getSalesOrderMaterialPreview(companyId: string, salesOrderId: string): Promise<SalesOrderMaterialPreview> {
  const order = await SalesOrderRepository.findByIdWithDetails(companyId, salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: salesOrderId });

  const items: SalesOrderMaterialPreviewItem[] = await Promise.all(
    order.items.map(async (item) => {
      const orderedQuantity = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
      const requirement = await getMaterialRequirementForOrderLine(companyId, {
        salesOrderItemId: item.id,
        productId: item.productId,
        quantity: orderedQuantity,
      });

      const materials = requirement.materials.map((m) => ({
        ...m,
        quantityPerUnit: orderedQuantity > 0 ? round4(m.neededQuantity / orderedQuantity) : 0,
      }));

      return {
        salesOrderItemId: item.id,
        productId: item.productId,
        styleName: item.product.styleName,
        sampleRequestId: item.sampleRequestId,
        sampleStyleName: item.sampleRequest?.styleName ?? null,
        orderedQuantity,
        hasApprovedBom: requirement.hasApprovedBom,
        materials,
        unconvertibleLines: requirement.unconvertibleLines,
        totalMaterialCost: requirement.totalMaterialCost,
        materialCostPerUnit: requirement.materialCostPerUnit,
      };
    })
  );

  // A line with materials but an unknown cost (a missing unitCost or an
  // unconvertible UOM somewhere in its own chain) makes the grand total
  // unknowable too — never silently undercount, matching this project's own
  // "flag as unavailable rather than undercount" convention.
  const anyUnknown = items.some((i) => i.hasApprovedBom && i.totalMaterialCost === null);
  const knownTotal = items.reduce((sum, i) => sum + (i.totalMaterialCost ?? 0), 0);

  return {
    salesOrder: { id: order.id, orderNumber: order.orderNumber, customerName: order.customer.name },
    items,
    grandTotalMaterialCost: anyUnknown ? null : round4(knownTotal),
  };
}

import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { getRawMaterialStockByLocation } from "./inventory.service";

/**
 * Raw material Stock Balances (2026-10-23): one row per raw material, read-only.
 * Replaces the separate Fabric Stock page.
 *
 * - Totals come from StockBalance, the ledger-maintained cache.
 * - A material's detail is shown one of three ways:
 *   - ROLL: it has rolls in stock (fabric) — by colour and roll, from FabricRoll.
 *     A roll's colour is its Purchase Order line's colour; its shade, GSM, width,
 *     composition and construction are its own fabric masters. Rolls with
 *     different specs are never merged into one figure.
 *   - COLOUR: no rolls, but colour-wise stock exists (StockColorBalance).
 *   - PLAIN: neither — just the quantity.
 * - Raw material has no reservation in this ERP, so Reserved is always 0 and Available = On Hand.
 */

const EPSILON = 0.0001;
const round = (n: number) => Math.round(n * 10000) / 10000;

/** A roll still holds usable stock while it is IN_STOCK or PARTIALLY_USED with meterage left. */
const ELIGIBLE_ROLL_WHERE = {
  status: { in: ["IN_STOCK", "PARTIALLY_USED"] },
  remainingQuantity: { gt: EPSILON },
} satisfies Prisma.FabricRollWhereInput;

export type StockBreakdownMode = "ROLL" | "COLOUR" | "PLAIN";

export async function listRawMaterialStock(
  companyId: string,
  query: ListQuery,
  filters: { warehouseId?: string; materialCategory?: string } = {}
) {
  const balanceWhere: Prisma.StockBalanceWhereInput = {
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
  };
  // An unknown category is ignored rather than passed to Prisma (which would throw).
  const category = MATERIAL_CATEGORIES.find((c) => c === filters.materialCategory);
  const where: Prisma.ProductWhereInput = {
    companyId,
    itemType: "RAW_MATERIAL",
    ...(category ? { materialCategory: category } : {}),
    deletedAt: null,
    stockBalances: { some: balanceWhere },
    ...(query.search
      ? {
          OR: [
            { styleName: { contains: query.search, mode: "insensitive" as const } },
            { styleCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [products, totalCount] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        styleName: true,
        styleCode: true,
        materialCategory: true,
        baseUom: { select: { code: true } },
        stockBalances: { where: balanceWhere, select: { quantityOnHand: true, updatedAt: true } },
      },
      orderBy: { styleName: "asc" },
      skip: query.skip,
      take: query.take,
    }),
    prisma.product.count({ where }),
  ]);

  const rollCounts = products.length
    ? await prisma.goodsReceiptItem.findMany({
        where: {
          productId: { in: products.map((p) => p.id) },
          ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
          goodsReceipt: { companyId },
        },
        select: { productId: true, _count: { select: { rolls: { where: ELIGIBLE_ROLL_WHERE } } } },
      })
    : [];
  const rollsByProduct = new Map<string, number>();
  for (const row of rollCounts) rollsByProduct.set(row.productId, (rollsByProduct.get(row.productId) ?? 0) + row._count.rolls);

  const colourRows = products.length
    ? await prisma.stockColorBalance.findMany({
        where: {
          companyId,
          productId: { in: products.map((p) => p.id) },
          quantityOnHand: { gt: EPSILON },
          ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
        },
        select: { productId: true, colorId: true },
      })
    : [];
  const coloursByProduct = new Map<string, Set<string>>();
  for (const row of colourRows) {
    if (!coloursByProduct.has(row.productId)) coloursByProduct.set(row.productId, new Set());
    coloursByProduct.get(row.productId)!.add(row.colorId);
  }

  const data = products.map((p) => {
    const totalStock = round(p.stockBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0));
    const rollCount = rollsByProduct.get(p.id) ?? 0;
    const colourCount = coloursByProduct.get(p.id)?.size ?? 0;
    const lastUpdated = p.stockBalances.reduce<Date | null>((latest, b) => (!latest || b.updatedAt > latest ? b.updatedAt : latest), null);
    return {
      id: p.id,
      productId: p.id,
      materialName: p.styleName,
      materialCode: p.styleCode,
      materialCategory: p.materialCategory,
      unit: p.baseUom?.code ?? null,
      totalStock,
      reservedStock: 0,
      availableStock: totalStock,
      rollCount,
      colourCount,
      breakdownMode: (rollCount > 0 ? "ROLL" : colourCount > 0 ? "COLOUR" : "PLAIN") as StockBreakdownMode,
      lastUpdated,
    };
  });
  return { data, totalCount };
}

interface MasterRef {
  code: string;
  name: string;
}

export interface FabricRollInput {
  id: string;
  rollNumber: string;
  batchNo: string | null;
  rollQuantity: number;
  remainingQuantity: number;
  color: { id: string; name: string; hexValue: string | null } | null;
  shade: (MasterRef & { id: string; pantone: string | null }) | null;
  composition: (MasterRef & { id: string }) | null;
  gsm: (MasterRef & { id: string }) | null;
  width: (MasterRef & { id: string }) | null;
  construction: (MasterRef & { id: string }) | null;
  warehouseName: string;
  locationLabel: string | null;
  receiptNumber: string;
}

const specLabel = (m: MasterRef | null) => m?.name ?? null;
const shadeCode = (shade: FabricRollInput["shade"]) => (shade ? shade.code : null);

/**
 * Groups rolls by colour. Within a colour, rolls that differ in shade,
 * composition, GSM, width or construction stay as separate spec groups.
 * Pure, so it is unit-tested directly.
 */
export function buildFabricColourGroups(rolls: FabricRollInput[]) {
  const groups = new Map<string, { colorId: string | null; colorName: string; hexValue: string | null; rolls: FabricRollInput[] }>();
  for (const roll of rolls) {
    const key = roll.color?.id ?? "__none__";
    if (!groups.has(key)) {
      groups.set(key, {
        colorId: roll.color?.id ?? null,
        colorName: roll.color?.name ?? "No colour recorded",
        hexValue: roll.color?.hexValue ?? null,
        rolls: [],
      });
    }
    groups.get(key)!.rolls.push(roll);
  }

  return [...groups.values()]
    .map((group) => {
      const specs = new Map<string, { quantity: number; initialQuantity: number; rollCount: number; sample: FabricRollInput }>();
      for (const roll of group.rolls) {
        const key = [roll.shade?.id, roll.composition?.id, roll.gsm?.id, roll.width?.id, roll.construction?.id].map((v) => v ?? "-").join("|");
        const spec = specs.get(key) ?? { quantity: 0, initialQuantity: 0, rollCount: 0, sample: roll };
        spec.quantity += roll.remainingQuantity;
        spec.initialQuantity += roll.rollQuantity;
        spec.rollCount += 1;
        specs.set(key, spec);
      }
      const shades = [...new Set(group.rolls.map((r) => shadeCode(r.shade)).filter((c): c is string => !!c))].sort();
      const sortedRolls = [...group.rolls].sort(
        (a, b) => (shadeCode(a.shade) ?? "").localeCompare(shadeCode(b.shade) ?? "") || a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true })
      );
      return {
        colorId: group.colorId,
        colorName: group.colorName,
        hexValue: group.hexValue,
        rollCount: group.rolls.length,
        shades,
        initialQuantity: round(group.rolls.reduce((sum, r) => sum + r.rollQuantity, 0)),
        availableQuantity: round(group.rolls.reduce((sum, r) => sum + r.remainingQuantity, 0)),
        specs: [...specs.values()]
          .map((s) => ({
            shadeCode: shadeCode(s.sample.shade),
            shadeName: s.sample.shade?.name ?? null,
            pantone: s.sample.shade?.pantone ?? null,
            composition: specLabel(s.sample.composition),
            gsm: specLabel(s.sample.gsm),
            width: specLabel(s.sample.width),
            construction: specLabel(s.sample.construction),
            rollCount: s.rollCount,
            initialQuantity: round(s.initialQuantity),
            availableQuantity: round(s.quantity),
          }))
          .sort((a, b) => (a.shadeCode ?? "").localeCompare(b.shadeCode ?? "")),
        rolls: sortedRolls.map((r) => ({
          id: r.id,
          rollNumber: r.rollNumber,
          lotNumber: r.batchNo || r.receiptNumber,
          shadeCode: shadeCode(r.shade),
          shadeName: r.shade?.name ?? null,
          composition: specLabel(r.composition),
          gsm: specLabel(r.gsm),
          width: specLabel(r.width),
          construction: specLabel(r.construction),
          warehouseName: r.warehouseName,
          locationLabel: r.locationLabel,
          initialQuantity: round(r.rollQuantity),
          remainingQuantity: round(r.remainingQuantity),
        })),
      };
    })
    .sort((a, b) => (a.colorId === null ? 1 : b.colorId === null ? -1 : a.colorName.localeCompare(b.colorName)));
}

/**
 * Colour-wise stock for a material with no rolls, from StockColorBalance.
 * One row per colour (summed over warehouses), each with its per-warehouse split.
 * Pure, so it is unit-tested directly.
 */
export function buildColourBalanceGroups(
  rows: Array<{ colorId: string; colorName: string; hexValue: string | null; warehouseName: string; quantity: number }>
) {
  const groups = new Map<string, { colorId: string; colorName: string; hexValue: string | null; quantity: number; warehouses: Array<{ warehouseName: string; quantity: number }> }>();
  for (const row of rows) {
    if (row.quantity <= EPSILON) continue;
    const group = groups.get(row.colorId) ?? { colorId: row.colorId, colorName: row.colorName, hexValue: row.hexValue, quantity: 0, warehouses: [] };
    group.quantity += row.quantity;
    group.warehouses.push({ warehouseName: row.warehouseName, quantity: round(row.quantity) });
    groups.set(row.colorId, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, quantity: round(g.quantity), warehouses: g.warehouses.sort((a, b) => a.warehouseName.localeCompare(b.warehouseName)) }))
    .sort((a, b) => a.colorName.localeCompare(b.colorName));
}

export async function getRawMaterialStockDetail(companyId: string, productId: string, filters: { warehouseId?: string } = {}) {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId, itemType: "RAW_MATERIAL", deletedAt: null },
    select: { id: true, styleName: true, styleCode: true, materialCategory: true, baseUom: { select: { code: true } } },
  });
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Material not found.", { productId });

  const warehouseFilter = filters.warehouseId ? { warehouseId: filters.warehouseId } : {};
  const [balances, colourRows, rollRows] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { companyId, productId, ...warehouseFilter },
      select: { warehouseId: true, quantityOnHand: true, warehouse: { select: { name: true } } },
    }),
    prisma.stockColorBalance.findMany({
      where: { companyId, productId, quantityOnHand: { gt: EPSILON }, ...warehouseFilter },
      select: {
        colorId: true,
        quantityOnHand: true,
        color: { select: { name: true, hexValue: true } },
        warehouse: { select: { name: true } },
      },
    }),
    prisma.fabricRoll.findMany({
      where: {
        companyId,
        ...ELIGIBLE_ROLL_WHERE,
        goodsReceiptItem: { productId, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
      },
      select: {
        id: true,
        rollNumber: true,
        batchNo: true,
        rollQuantity: true,
        remainingQuantity: true,
        dye: { select: { id: true, code: true, name: true, pantone: true } },
        composition: { select: { id: true, code: true, name: true } },
        gsm: { select: { id: true, code: true, name: true } },
        width: { select: { id: true, code: true, name: true } },
        weaveType: { select: { id: true, code: true, name: true } },
        warehouseLocation: { select: { code: true, zone: true, rack: true, shelf: true, bin: true } },
        goodsReceiptItem: {
          select: {
            warehouse: { select: { name: true } },
            warehouseLocation: { select: { code: true, zone: true, rack: true, shelf: true, bin: true } },
            goodsReceipt: { select: { receiptNumber: true } },
            purchaseOrderItem: { select: { color: { select: { id: true, name: true, hexValue: true } } } },
          },
        },
      },
    }),
  ]);

  const locationLabel = (l: { code: string; zone: string | null; rack: string | null; shelf: string | null; bin: string | null } | null) => {
    if (!l) return null;
    const parts = [l.zone, l.rack, l.shelf, l.bin].filter(Boolean).join(" / ");
    return parts ? `${l.code} (${parts})` : l.code;
  };

  const rolls: FabricRollInput[] = rollRows.map((r) => ({
    id: r.id,
    rollNumber: r.rollNumber,
    batchNo: r.batchNo,
    rollQuantity: Number(r.rollQuantity),
    remainingQuantity: Number(r.remainingQuantity),
    color: r.goodsReceiptItem.purchaseOrderItem.color,
    shade: r.dye,
    composition: r.composition,
    gsm: r.gsm,
    width: r.width,
    construction: r.weaveType,
    warehouseName: r.goodsReceiptItem.warehouse.name,
    locationLabel: locationLabel(r.warehouseLocation ?? r.goodsReceiptItem.warehouseLocation),
    receiptNumber: r.goodsReceiptItem.goodsReceipt.receiptNumber,
  }));

  const totalStock = round(balances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0));
  const rolledStock = round(rolls.reduce((sum, r) => sum + r.remainingQuantity, 0));
  const colourBalances = buildColourBalanceGroups(
    colourRows.map((r) => ({
      colorId: r.colorId,
      colorName: r.color.name,
      hexValue: r.color.hexValue,
      warehouseName: r.warehouse.name,
      quantity: Number(r.quantityOnHand),
    }))
  );
  const colouredStock = round(colourBalances.reduce((sum, c) => sum + c.quantity, 0));
  const breakdownMode: StockBreakdownMode = rolls.length > 0 ? "ROLL" : colourBalances.length > 0 ? "COLOUR" : "PLAIN";

  // Warehouse-wise split, with the ledger's own per-location figures.
  const warehouses = await Promise.all(
    balances
      .filter((b) => Number(b.quantityOnHand) > EPSILON)
      .map(async (b) => {
        const byLocation = await getRawMaterialStockByLocation(companyId, productId, b.warehouseId);
        return {
          warehouseId: b.warehouseId,
          warehouseName: b.warehouse.name,
          quantity: round(Number(b.quantityOnHand)),
          locations: byLocation.locations.map((l) => ({ label: l.label, quantity: l.quantity })),
          unassignedQuantity: byLocation.unassignedQuantity,
        };
      })
  );
  warehouses.sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));

  return {
    materialId: product.id,
    materialName: product.styleName,
    materialCode: product.styleCode,
    materialCategory: product.materialCategory,
    unit: product.baseUom?.code ?? null,
    breakdownMode,
    totalStock,
    reservedStock: 0,
    availableStock: totalStock,
    rollCount: rolls.length,
    rolledStock,
    // Stock in the ledger that no roll accounts for (e.g. opening stock, or an issue made without picking a roll).
    notRollTrackedStock: round(Math.max(0, totalStock - rolledStock)),
    colours: buildFabricColourGroups(rolls),
    colourBalances,
    // Stock not tagged with any colour (only meaningful in COLOUR mode).
    noColourStock: round(Math.max(0, totalStock - colouredStock)),
    warehouses,
  };
}

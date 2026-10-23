import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";

/**
 * Fabric Stock (2026-10-23): fabric stock by colour and roll, read-only.
 *
 * - Totals come from StockBalance, the ledger-maintained cache.
 * - Colour and roll detail come from FabricRoll.
 *   - A roll's colour is its Purchase Order line's colour.
 *   - Its shade, GSM, width, composition and construction are its own fabric masters.
 * - Rolls with different specs are never merged into one figure.
 * - Raw material has no reservation in this ERP, so Reserved is always 0 and Available = On Hand.
 */

const EPSILON = 0.0001;
const round = (n: number) => Math.round(n * 10000) / 10000;

/** A roll still holds usable stock while it is IN_STOCK or PARTIALLY_USED with meterage left. */
const ELIGIBLE_ROLL_WHERE = {
  status: { in: ["IN_STOCK", "PARTIALLY_USED"] },
  remainingQuantity: { gt: EPSILON },
} satisfies Prisma.FabricRollWhereInput;

export async function listFabricStock(companyId: string, query: ListQuery, filters: { warehouseId?: string } = {}) {
  const balanceWhere: Prisma.StockBalanceWhereInput = {
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
  };
  const where: Prisma.ProductWhereInput = {
    companyId,
    itemType: "RAW_MATERIAL",
    materialCategory: "FABRIC",
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
        baseUom: { select: { code: true } },
        stockBalances: { where: balanceWhere, select: { quantityOnHand: true } },
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

  const data = products.map((p) => {
    const totalStock = round(p.stockBalances.reduce((sum, b) => sum + Number(b.quantityOnHand), 0));
    return {
      id: p.id,
      productId: p.id,
      fabricName: p.styleName,
      fabricCode: p.styleCode,
      unit: p.baseUom?.code ?? null,
      totalStock,
      reservedStock: 0,
      availableStock: totalStock,
      rollCount: rollsByProduct.get(p.id) ?? 0,
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

export async function getFabricStockDetail(companyId: string, productId: string, filters: { warehouseId?: string } = {}) {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId, itemType: "RAW_MATERIAL", deletedAt: null },
    select: { id: true, styleName: true, styleCode: true, materialCategory: true, baseUom: { select: { code: true } } },
  });
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Fabric not found.", { productId });

  const [balances, rollRows] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { companyId, productId, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
      select: { quantityOnHand: true },
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
  return {
    fabricId: product.id,
    fabricName: product.styleName,
    fabricCode: product.styleCode,
    unit: product.baseUom?.code ?? null,
    totalStock,
    reservedStock: 0,
    availableStock: totalStock,
    rollCount: rolls.length,
    rolledStock,
    // Stock in the ledger that no roll accounts for (e.g. opening stock, or an issue made without picking a roll).
    notRollTrackedStock: round(Math.max(0, totalStock - rolledStock)),
    colours: buildFabricColourGroups(rolls),
  };
}

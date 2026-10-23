import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";

/**
 * Finished Goods Stock List, style-wise (2026-10-23) — the Finished Goods
 * sibling of raw material Stock Balances: one row per style, opening to a
 * colour → size breakdown plus a warehouse-wise table. Reads only
 * FinishedGoodsStockBalance, like every other Finished Goods screen.
 *
 * Stock with no variant (productVariantId null — pre-variant-tracking or a
 * style with no variants) is shown as its own "No colour / size" group,
 * never folded into a real colour.
 */

const EPSILON = 0.0001;
const round = (n: number) => Math.round(n * 10000) / 10000;

export async function listFinishedGoodsStyleStock(
  companyId: string,
  query: ListQuery,
  filters: { warehouseId?: string; showZeroStock?: boolean } = {}
) {
  const balanceWhere: Prisma.FinishedGoodsStockBalanceWhereInput = {
    companyId,
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
  };
  const where: Prisma.ProductWhereInput = {
    companyId,
    itemType: "STYLE",
    deletedAt: null,
    // Styles whose stock has run out are hidden unless asked for.
    finishedGoodsStockBalances: {
      some: filters.showZeroStock ? balanceWhere : { ...balanceWhere, quantityOnHand: { gt: EPSILON } },
    },
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
        category: { select: { name: true } },
        finishedGoodsStockBalances: {
          where: balanceWhere,
          select: {
            quantityOnHand: true,
            stockStatus: true,
            warehouseId: true,
            updatedAt: true,
            productVariant: { select: { colorId: true, sizeId: true } },
          },
        },
      },
      orderBy: { styleName: "asc" },
      skip: query.skip,
      take: query.take,
    }),
    prisma.product.count({ where }),
  ]);

  const data = products.map((p) => {
    let saleable = 0;
    let rejected = 0;
    const colours = new Set<string>();
    const sizes = new Set<string>();
    const warehouses = new Set<string>();
    let lastUpdated: Date | null = null;
    for (const b of p.finishedGoodsStockBalances) {
      const quantity = Number(b.quantityOnHand);
      if (b.stockStatus === "SALEABLE") saleable += quantity;
      else rejected += quantity;
      if (quantity > EPSILON) {
        if (b.productVariant) {
          colours.add(b.productVariant.colorId);
          sizes.add(b.productVariant.sizeId);
        }
        warehouses.add(b.warehouseId);
      }
      if (!lastUpdated || b.updatedAt > lastUpdated) lastUpdated = b.updatedAt;
    }
    return {
      id: p.id,
      productId: p.id,
      styleName: p.styleName,
      styleCode: p.styleCode,
      categoryName: p.category?.name ?? null,
      saleableStock: round(saleable),
      rejectedStock: round(rejected),
      totalStock: round(saleable + rejected),
      colourCount: colours.size,
      sizeCount: sizes.size,
      warehouseCount: warehouses.size,
      lastUpdated,
    };
  });
  return { data, totalCount };
}

export interface StyleStockBalanceInput {
  quantity: number;
  stockStatus: "SALEABLE" | "REJECTED";
  color: { id: string; name: string; hexValue: string | null } | null;
  size: { id: string; name: string; sortOrder: number } | null;
  warehouseId: string;
  warehouseName: string;
  locationCode: string | null;
}

/**
 * Groups one style's balance rows by colour, then by size. Each size row
 * keeps its saleable/rejected split and where the pieces sit. Pure, so it is
 * unit-tested directly.
 */
export function buildStyleColourGroups(rows: StyleStockBalanceInput[]) {
  type SizeAcc = { sizeId: string | null; sizeName: string; sortOrder: number; saleable: number; rejected: number; places: Map<string, number> };
  const colours = new Map<string, { colorId: string | null; colorName: string; hexValue: string | null; sizes: Map<string, SizeAcc> }>();

  for (const row of rows) {
    if (row.quantity <= EPSILON) continue;
    const colourKey = row.color?.id ?? "__none__";
    const colour = colours.get(colourKey) ?? {
      colorId: row.color?.id ?? null,
      colorName: row.color?.name ?? "No colour / size recorded",
      hexValue: row.color?.hexValue ?? null,
      sizes: new Map<string, SizeAcc>(),
    };
    colours.set(colourKey, colour);

    const sizeKey = row.size?.id ?? "__none__";
    const size = colour.sizes.get(sizeKey) ?? {
      sizeId: row.size?.id ?? null,
      sizeName: row.size?.name ?? "—",
      sortOrder: row.size?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      saleable: 0,
      rejected: 0,
      places: new Map<string, number>(),
    };
    colour.sizes.set(sizeKey, size);

    if (row.stockStatus === "SALEABLE") size.saleable += row.quantity;
    else size.rejected += row.quantity;
    const place = row.locationCode ? `${row.warehouseName} / ${row.locationCode}` : `${row.warehouseName} (no location)`;
    size.places.set(place, (size.places.get(place) ?? 0) + row.quantity);
  }

  return [...colours.values()]
    .map((c) => {
      const sizes = [...c.sizes.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.sizeName.localeCompare(b.sizeName))
        .map((s) => ({
          sizeId: s.sizeId,
          sizeName: s.sizeName,
          saleableQuantity: round(s.saleable),
          rejectedQuantity: round(s.rejected),
          places: [...s.places.entries()].map(([label, quantity]) => ({ label, quantity: round(quantity) })).sort((a, b) => a.label.localeCompare(b.label)),
        }));
      return {
        colorId: c.colorId,
        colorName: c.colorName,
        hexValue: c.hexValue,
        sizes,
        saleableQuantity: round(sizes.reduce((sum, s) => sum + s.saleableQuantity, 0)),
        rejectedQuantity: round(sizes.reduce((sum, s) => sum + s.rejectedQuantity, 0)),
      };
    })
    .sort((a, b) => (a.colorId === null ? 1 : b.colorId === null ? -1 : a.colorName.localeCompare(b.colorName)));
}

export async function getFinishedGoodsStyleStockBreakdown(companyId: string, productId: string, filters: { warehouseId?: string } = {}) {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId, itemType: "STYLE", deletedAt: null },
    select: { id: true },
  });
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { productId });

  const rows = await prisma.finishedGoodsStockBalance.findMany({
    where: { companyId, productId, quantityOnHand: { gt: EPSILON }, ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) },
    select: {
      quantityOnHand: true,
      stockStatus: true,
      warehouseId: true,
      warehouse: { select: { name: true } },
      warehouseLocation: { select: { code: true } },
      productVariant: {
        select: {
          color: { select: { id: true, name: true, hexValue: true } },
          size: { select: { id: true, name: true, sortOrder: true } },
        },
      },
    },
  });

  const inputs: StyleStockBalanceInput[] = rows.map((r) => ({
    quantity: Number(r.quantityOnHand),
    stockStatus: r.stockStatus,
    color: r.productVariant?.color ?? null,
    size: r.productVariant?.size ?? null,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouse.name,
    locationCode: r.warehouseLocation?.code ?? null,
  }));

  const byWarehouse = new Map<string, { warehouseName: string; saleable: number; rejected: number; locations: Map<string, number> }>();
  for (const r of inputs) {
    const w = byWarehouse.get(r.warehouseId) ?? { warehouseName: r.warehouseName, saleable: 0, rejected: 0, locations: new Map<string, number>() };
    if (r.stockStatus === "SALEABLE") w.saleable += r.quantity;
    else w.rejected += r.quantity;
    const loc = r.locationCode ?? "No location";
    w.locations.set(loc, (w.locations.get(loc) ?? 0) + r.quantity);
    byWarehouse.set(r.warehouseId, w);
  }

  const saleable = inputs.filter((r) => r.stockStatus === "SALEABLE").reduce((sum, r) => sum + r.quantity, 0);
  const rejected = inputs.filter((r) => r.stockStatus === "REJECTED").reduce((sum, r) => sum + r.quantity, 0);
  return {
    saleableStock: round(saleable),
    rejectedStock: round(rejected),
    colours: buildStyleColourGroups(inputs),
    warehouses: [...byWarehouse.entries()]
      .map(([warehouseId, w]) => ({
        warehouseId,
        warehouseName: w.warehouseName,
        saleableQuantity: round(w.saleable),
        rejectedQuantity: round(w.rejected),
        locations: [...w.locations.entries()].map(([label, quantity]) => ({ label, quantity: round(quantity) })).sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName)),
  };
}

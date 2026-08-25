import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "inventory" as const;

function parseDateRange(filters: Record<string, string>): { dateFrom?: Date; dateTo?: Date } {
  return {
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
}

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Stock Summary — one row per StockBalance row across all warehouses.
// ---------------------------------------------------------------------------
async function getStockSummaryDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const balances = await prisma.stockBalance.findMany({
    where: {
      companyId,
      ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    },
    select: {
      productId: true,
      quantityOnHand: true,
      product: { select: { styleCode: true, styleName: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: [{ product: { styleName: "asc" } }, { warehouse: { name: "asc" } }],
  });

  const rows = balances.map((b) => ({
    productId: b.productId,
    styleCode: b.product.styleCode,
    styleName: b.product.styleName,
    warehouse: b.warehouse.name,
    quantityOnHand: Number(b.quantityOnHand),
  }));

  return {
    title: "Stock Summary",
    subtitle: "Current stock on hand across all warehouses.",
    filtersApplied: filtersApplied(filters, { warehouseId: "Warehouse" }),
    columns: [
      { key: "styleCode", label: "Style Code", linkTo: "product" },
      { key: "styleName", label: "Style Name" },
      { key: "warehouse", label: "Warehouse" },
      { key: "quantityOnHand", label: "Quantity On Hand", type: "number", align: "right" },
    ],
    rows,
    totals: { quantityOnHand: rows.reduce((s, r) => s + r.quantityOnHand, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Stock Ledger — one row per InventoryTransaction. Can be a large table;
// capped at 5000 rows shown (most recent first), but totals are always
// computed from the FULL filtered set via a separate aggregate query.
// ---------------------------------------------------------------------------
const STOCK_LEDGER_ROW_CAP = 5000;

async function getStockLedgerDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const where = {
    companyId,
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    ...(dateFrom || dateTo ? { performedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
  };

  const [transactions, totalCount, sumAgg] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      select: {
        id: true,
        productId: true,
        performedAt: true,
        transactionType: true,
        quantity: true,
        referenceModule: true,
        notes: true,
        product: { select: { styleCode: true, styleName: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { performedAt: "desc" },
      take: STOCK_LEDGER_ROW_CAP,
    }),
    prisma.inventoryTransaction.count({ where }),
    prisma.inventoryTransaction.aggregate({ where, _sum: { quantity: true } }),
  ]);

  const rows = transactions.map((t) => ({
    productId: t.productId,
    performedAt: t.performedAt,
    styleCode: t.product.styleCode,
    styleName: t.product.styleName,
    warehouse: t.warehouse.name,
    transactionType: t.transactionType,
    quantity: Number(t.quantity),
    referenceModule: t.referenceModule,
    notes: t.notes ?? "—",
  }));

  return {
    title: "Stock Ledger",
    subtitle:
      rows.length < totalCount
        ? `Showing the most recent ${rows.length.toLocaleString()} of ${totalCount.toLocaleString()} matching transactions. Totals below reflect all ${totalCount.toLocaleString()}.`
        : "Every inventory transaction matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", warehouseId: "Warehouse" }),
    columns: [
      { key: "performedAt", label: "Date", type: "date" },
      { key: "styleCode", label: "Style Code", linkTo: "product" },
      { key: "styleName", label: "Style Name" },
      { key: "warehouse", label: "Warehouse" },
      { key: "transactionType", label: "Transaction Type" },
      { key: "quantity", label: "Quantity", type: "number", align: "right" },
      { key: "referenceModule", label: "Reference Module" },
      { key: "notes", label: "Notes" },
    ],
    rows,
    totals: { quantity: Number(sumAgg._sum.quantity ?? 0) },
    meta: { page: 1, pageSize: rows.length, totalCount },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Low Stock Report — quantityOnHand < product.reorderLevel (reorderLevel
// not null). Prisma can't compare two columns in a `where`, so this filters
// in application code after fetching every StockBalance row for the company.
// ---------------------------------------------------------------------------
async function getLowStockReportDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const balances = await prisma.stockBalance.findMany({
    where: { companyId },
    select: {
      productId: true,
      quantityOnHand: true,
      product: { select: { styleCode: true, styleName: true, reorderLevel: true } },
      warehouse: { select: { name: true } },
    },
  });

  const rows = balances
    .filter((b) => b.product.reorderLevel !== null && Number(b.quantityOnHand) < Number(b.product.reorderLevel))
    .map((b) => {
      const quantityOnHand = Number(b.quantityOnHand);
      const reorderLevel = Number(b.product.reorderLevel);
      return {
        productId: b.productId,
        styleCode: b.product.styleCode,
        styleName: b.product.styleName,
        warehouse: b.warehouse.name,
        quantityOnHand,
        reorderLevel,
        shortfall: reorderLevel - quantityOnHand,
      };
    })
    .sort((a, b) => b.shortfall - a.shortfall);

  return {
    title: "Low Stock Report",
    subtitle: "Stock balances below their Product master's configured Reorder Level.",
    filtersApplied: filtersApplied(filters, {}),
    columns: [
      { key: "styleCode", label: "Style Code", linkTo: "product" },
      { key: "styleName", label: "Style Name" },
      { key: "warehouse", label: "Warehouse" },
      { key: "quantityOnHand", label: "Quantity On Hand", type: "number", align: "right" },
      { key: "reorderLevel", label: "Reorder Level", type: "number", align: "right" },
      { key: "shortfall", label: "Shortfall", type: "number", align: "right" },
    ],
    rows,
    totals: { shortfall: rows.reduce((s, r) => s + r.shortfall, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 4. Negative Stock Report — a data-integrity check; should be rare/never
// given this ERP's guarded-decrement discipline, but real if it ever occurs.
// ---------------------------------------------------------------------------
async function getNegativeStockReportDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const balances = await prisma.stockBalance.findMany({
    where: { companyId, quantityOnHand: { lt: 0 } },
    select: {
      productId: true,
      quantityOnHand: true,
      product: { select: { styleCode: true, styleName: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { quantityOnHand: "asc" },
  });

  const rows = balances.map((b) => ({
    productId: b.productId,
    styleCode: b.product.styleCode,
    styleName: b.product.styleName,
    warehouse: b.warehouse.name,
    quantityOnHand: Number(b.quantityOnHand),
  }));

  return {
    title: "Negative Stock Report",
    subtitle: "Stock balances that have gone negative — a data-integrity check; this should normally be empty.",
    filtersApplied: filtersApplied(filters, {}),
    columns: [
      { key: "styleCode", label: "Style Code", linkTo: "product" },
      { key: "styleName", label: "Style Name" },
      { key: "warehouse", label: "Warehouse" },
      { key: "quantityOnHand", label: "Quantity On Hand", type: "number", align: "right" },
    ],
    rows,
    totals: { quantityOnHand: rows.reduce((s, r) => s + r.quantityOnHand, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 5. Stock Valuation — quantityOnHand * product.unitCost, for rows where the
// Product master actually has a unitCost set. Rows with no unitCost are
// excluded but counted and surfaced in the subtitle, never silently dropped.
// ---------------------------------------------------------------------------
async function getStockValuationDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const balances = await prisma.stockBalance.findMany({
    where: { companyId },
    select: {
      productId: true,
      quantityOnHand: true,
      product: { select: { styleCode: true, styleName: true, unitCost: true } },
      warehouse: { select: { name: true } },
    },
  });

  const withCost = balances.filter((b) => b.product.unitCost !== null);
  const excludedCount = balances.length - withCost.length;

  const rows = withCost
    .map((b) => {
      const quantityOnHand = Number(b.quantityOnHand);
      const unitCost = Number(b.product.unitCost);
      return {
        productId: b.productId,
        styleCode: b.product.styleCode,
        styleName: b.product.styleName,
        warehouse: b.warehouse.name,
        quantityOnHand,
        unitCost,
        stockValue: quantityOnHand * unitCost,
      };
    })
    .sort((a, b) => b.stockValue - a.stockValue);

  return {
    title: "Stock Valuation",
    subtitle:
      excludedCount > 0
        ? `${excludedCount} item(s) excluded — no unit cost set on their Product master.`
        : "Stock on hand valued at each Product master's Unit Cost.",
    filtersApplied: filtersApplied(filters, {}),
    columns: [
      { key: "styleCode", label: "Style Code", linkTo: "product" },
      { key: "styleName", label: "Style Name" },
      { key: "warehouse", label: "Warehouse" },
      { key: "quantityOnHand", label: "Quantity On Hand", type: "number", align: "right" },
      { key: "unitCost", label: "Unit Cost", type: "currency", align: "right" },
      { key: "stockValue", label: "Stock Value", type: "currency", align: "right" },
    ],
    rows,
    totals: { stockValue: rows.reduce((s, r) => s + r.stockValue, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "stock-summary", title: "Stock Summary", buildDescriptor: getStockSummaryDescriptor });
registerReport({
  category: CATEGORY,
  key: "stock-ledger",
  title: "Stock Ledger",
  buildDescriptor: getStockLedgerDescriptor,
  pdfOrientation: "landscape",
});
registerReport({ category: CATEGORY, key: "low-stock-report", title: "Low Stock Report", buildDescriptor: getLowStockReportDescriptor });
registerReport({ category: CATEGORY, key: "negative-stock-report", title: "Negative Stock Report", buildDescriptor: getNegativeStockReportDescriptor });
registerReport({ category: CATEGORY, key: "stock-valuation", title: "Stock Valuation", buildDescriptor: getStockValuationDescriptor });

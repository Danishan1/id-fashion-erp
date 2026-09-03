import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { round2 } from "@/lib/money";

const CATEGORY = "warehouse" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

/** Warehouse.type is an array (a warehouse can store more than one material
 * kind) — formatted the same way as the Warehouses master list. */
function formatWarehouseTypes(types: string[]) {
  return types.map((t) => t.replace(/_/g, " ")).join(", ") || "—";
}

// ---------------------------------------------------------------------------
// 1. Warehouse Stock Summary — per-warehouse rollup, reusing the exact same
// StockBalance/unitCost/reorderLevel source as the Inventory category's own
// Stock Summary/Low Stock/Stock Valuation reports (never a second calculation).
// ---------------------------------------------------------------------------
async function getWarehouseStockSummaryDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const [warehouses, balances] = await Promise.all([
    prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true, type: true, isActive: true } }),
    prisma.stockBalance.findMany({
      where: { companyId },
      select: { warehouseId: true, quantityOnHand: true, product: { select: { unitCost: true, reorderLevel: true } } },
    }),
  ]);

  interface WarehouseAgg {
    warehouseId: string;
    code: string;
    name: string;
    type: string;
    skuCount: number;
    totalQuantity: number;
    stockValue: number;
    lowStockCount: number;
  }
  const byWarehouse = new Map<string, WarehouseAgg>();
  for (const w of warehouses) {
    byWarehouse.set(w.id, { warehouseId: w.id, code: w.code, name: w.name, type: formatWarehouseTypes(w.type), skuCount: 0, totalQuantity: 0, stockValue: 0, lowStockCount: 0 });
  }
  for (const b of balances) {
    const agg = byWarehouse.get(b.warehouseId);
    if (!agg) continue;
    const qty = Number(b.quantityOnHand);
    agg.skuCount += 1;
    agg.totalQuantity += qty;
    if (b.product.unitCost !== null) agg.stockValue = round2(agg.stockValue + qty * Number(b.product.unitCost));
    if (b.product.reorderLevel !== null && qty < Number(b.product.reorderLevel)) agg.lowStockCount += 1;
  }

  const rows = [...byWarehouse.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    title: "Warehouse Stock Summary",
    subtitle: "Per-warehouse stock rollup — SKU count, total quantity, stock value, and low-stock item count.",
    filtersApplied: [],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Warehouse" },
      { key: "type", label: "Type" },
      { key: "skuCount", label: "SKU Count", type: "number", align: "right" },
      { key: "totalQuantity", label: "Total Quantity", type: "number", align: "right" },
      { key: "stockValue", label: "Stock Value", type: "currency", align: "right" },
      { key: "lowStockCount", label: "Low Stock Items", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      skuCount: rows.reduce((s, r) => s + r.skuCount, 0),
      totalQuantity: rows.reduce((s, r) => s + r.totalQuantity, 0),
      stockValue: round2(rows.reduce((s, r) => s + r.stockValue, 0)),
      lowStockCount: rows.reduce((s, r) => s + r.lowStockCount, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Warehouse Register — the warehouse master itself, with a live location
// count (WarehouseLocation is a real, separately-managed sub-master).
// ---------------------------------------------------------------------------
async function getWarehouseRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const warehouses = await prisma.warehouse.findMany({
    where: { companyId, ...(filters.status ? { isActive: filters.status === "true" } : {}) },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isActive: true,
      managerEmployeeId: true,
      _count: { select: { locations: true } },
    },
    orderBy: { name: "asc" },
  });

  // Warehouse.managerEmployeeId is a plain scalar column with no declared
  // Prisma relation to Employee — resolved with a separate lookup rather
  // than an `include`, which Prisma has no field for here.
  const managerIds = [...new Set(warehouses.map((w) => w.managerEmployeeId).filter((id): id is string => !!id))];
  const managers = managerIds.length > 0 ? await prisma.employee.findMany({ where: { id: { in: managerIds } }, select: { id: true, fullName: true } }) : [];
  const managerNameById = new Map(managers.map((m) => [m.id, m.fullName]));

  const rows = warehouses.map((w) => ({
    warehouseId: w.id,
    code: w.code,
    name: w.name,
    type: formatWarehouseTypes(w.type),
    manager: w.managerEmployeeId ? (managerNameById.get(w.managerEmployeeId) ?? "—") : "—",
    locationCount: w._count.locations,
    status: w.isActive ? "Active" : "Inactive",
  }));

  return {
    title: "Warehouse Register",
    subtitle: "All warehouses matching the selected filters, with their configured location count.",
    filtersApplied: filtersApplied(filters, { status: "Status" }),
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Warehouse" },
      { key: "type", label: "Type" },
      { key: "manager", label: "Manager" },
      { key: "locationCount", label: "Location Count", type: "number", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "warehouse-stock-summary", title: "Warehouse Stock Summary", buildDescriptor: (c, g) => getWarehouseStockSummaryDescriptor(c, g) });
registerReport({ category: CATEGORY, key: "warehouse-register", title: "Warehouse Register", buildDescriptor: getWarehouseRegisterDescriptor });

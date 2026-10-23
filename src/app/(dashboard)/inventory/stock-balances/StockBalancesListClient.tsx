"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ViewIcon } from "@/components/ui/icons";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";

interface StockRow {
  id: string;
  productId: string;
  materialName: string;
  materialCode: string;
  materialCategory: string | null;
  unit: string | null;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  rollCount: number;
  colourCount: number;
  breakdownMode: "ROLL" | "COLOUR" | "PLAIN";
  lastUpdated: string | null;
}

interface WarehouseOption {
  id: string;
  name: string;
}

const qty = (n: number) => n.toLocaleString("en-IN");
const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();

function breakdownLabel(row: StockRow) {
  if (row.breakdownMode === "ROLL") return `${row.rollCount} roll${row.rollCount === 1 ? "" : "s"}`;
  if (row.breakdownMode === "COLOUR") return `${row.colourCount} colour${row.colourCount === 1 ? "" : "s"}`;
  return "—";
}

export function StockBalancesListClient() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [category, setCategory] = useState("");
  const [showZeroStock, setShowZeroStock] = useState(false);

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const params = new URLSearchParams();
  if (warehouseId) params.set("warehouseId", warehouseId);
  if (category) params.set("materialCategory", category);
  if (showZeroStock) params.set("showZeroStock", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const exportQs = warehouseId ? `?warehouseId=${warehouseId}` : "";

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Stock Balances" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stock Balances</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Stock of every raw material from the inventory ledger. Open a material to see it by roll (fabric), by colour, or
            warehouse-wise.
          </p>
        </div>
        <a
          href={`/api/v1/inventory/stock-balances/export/xlsx${exportQs}`}
          className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Download Excel
        </a>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="w-64">
          <SearchableSelect
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
            placeholder="Search warehouse…"
            emptyOptionLabel="All Warehouses"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">All Categories</option>
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={showZeroStock} onChange={(e) => setShowZeroStock(e.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
          Show zero stock
        </label>
      </div>

      <DataTable<StockRow>
        key={qs}
        fetchUrl={`/api/v1/inventory/stock-balances${qs}`}
        highlightHeader
        searchPlaceholder="Search by material name or code…"
        rowHref={(row) => `/inventory/stock-balances/${row.productId}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`}
        rowHrefLabel="View"
        rowHrefIcon={<ViewIcon />}
        columns={[
          {
            key: "materialName",
            header: "Material",
            render: (row) => (
              <span>
                {row.materialName} <span className="text-xs text-zinc-500">({row.materialCode})</span>
              </span>
            ),
          },
          { key: "materialCategory", header: "Category", render: (row) => (row.materialCategory ? titleCase(row.materialCategory) : "—") },
          { key: "totalStock", header: "Total Stock", render: (row) => qty(row.totalStock) },
          { key: "unit", header: "Unit", render: (row) => row.unit ?? "—" },
          { key: "availableStock", header: "Available Stock", render: (row) => qty(row.availableStock) },
          { key: "reservedStock", header: "Reserved Stock", render: (row) => qty(row.reservedStock) },
          { key: "breakdown", header: "Rolls / Colours", render: breakdownLabel },
          {
            key: "lastUpdated",
            header: "Last Updated",
            render: (row) => (row.lastUpdated ? new Date(row.lastUpdated).toLocaleString("en-IN") : "—"),
          },
        ]}
      />
    </div>
  );
}

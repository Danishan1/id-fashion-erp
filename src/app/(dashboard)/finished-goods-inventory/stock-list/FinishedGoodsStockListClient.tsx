"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ViewIcon } from "@/components/ui/icons";

interface StyleStockRow {
  id: string;
  productId: string;
  styleName: string;
  styleCode: string;
  categoryName: string | null;
  saleableStock: number;
  rejectedStock: number;
  totalStock: number;
  colourCount: number;
  sizeCount: number;
  warehouseCount: number;
  lastUpdated: string | null;
}

interface WarehouseOption {
  id: string;
  name: string;
}

const qty = (n: number) => n.toLocaleString("en-IN");

export function FinishedGoodsStockListClient() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [showZeroStock, setShowZeroStock] = useState(false);

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const params = new URLSearchParams();
  if (warehouseId) params.set("warehouseId", warehouseId);
  if (showZeroStock) params.set("showZeroStock", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Finished Goods Inventory", href: "/finished-goods-inventory" },
          { label: "Stock List" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Finished Goods Stock List</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Finished goods stock per style. Open a style to see it colour-wise and size-wise, and warehouse-wise.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SearchableSelect
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
            placeholder="Search warehouse…"
            emptyOptionLabel="All Warehouses"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={showZeroStock} onChange={(e) => setShowZeroStock(e.target.checked)} className="h-4 w-4 rounded border-zinc-300" />
          Show zero stock
        </label>
      </div>

      <DataTable<StyleStockRow>
        key={qs}
        fetchUrl={`/api/v1/finished-goods-inventory/style-stock${qs}`}
        highlightHeader
        searchPlaceholder="Search by style name or code…"
        rowHref={(row) => `/finished-goods-inventory/style-stock-details/${row.productId}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`}
        rowHrefLabel="View"
        rowHrefIcon={<ViewIcon />}
        columns={[
          {
            key: "styleName",
            header: "Style",
            render: (row) => (
              <span>
                {row.styleName} <span className="text-xs text-zinc-500">({row.styleCode})</span>
              </span>
            ),
          },
          { key: "categoryName", header: "Category", render: (row) => row.categoryName ?? "—" },
          { key: "saleableStock", header: "Saleable Stock", render: (row) => qty(row.saleableStock) },
          { key: "rejectedStock", header: "Rejected Stock", render: (row) => qty(row.rejectedStock) },
          { key: "totalStock", header: "Total Stock", render: (row) => qty(row.totalStock) },
          { key: "colourCount", header: "Colours", render: (row) => (row.colourCount ? row.colourCount : "—") },
          { key: "sizeCount", header: "Sizes", render: (row) => (row.sizeCount ? row.sizeCount : "—") },
          { key: "warehouseCount", header: "Warehouses", render: (row) => row.warehouseCount },
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

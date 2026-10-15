"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface Option {
  id: string;
  name?: string;
  code?: string;
}

interface WarehouseLocationOption {
  id: string;
  code: string;
}

interface StockRow {
  id: string;
  quantityOnHand: string;
  stockStatus: "SALEABLE" | "REJECTED";
  updatedAt: string;
  productVariant: { color: { name: string }; size: { name: string } } | null;
  warehouse: { code: string; name: string } | null;
  warehouseLocation: { code: string } | null;
}

interface StyleStockSummary {
  product: { id: string; styleCode: string; styleName: string };
  saleableQuantity: number;
  rejectedQuantity: number;
  distinctVariantCount: number;
  distinctWarehouseCount: number;
}

const STOCK_STATUS_OPTIONS = [
  { value: "SALEABLE", label: "Saleable" },
  { value: "REJECTED", label: "Rejected" },
];

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
    </div>
  );
}

export function StyleStockDetailsClient({ productId, summary }: { productId: string; summary: StyleStockSummary }) {
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [locations, setLocations] = useState<WarehouseLocationOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouseLocationId, setWarehouseLocationId] = useState("");

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  // react-hooks/set-state-in-effect — the "clear the dependent Location
  // field when Warehouse changes" reset happens synchronously in
  // handleWarehouseChange below, not in this effect's body, matching the
  // established fix pattern already used by FGI-051's own Stock List.
  useEffect(() => {
    if (!warehouseId) return;
    fetch(`/api/v1/warehouses/${warehouseId}`)
      .then((res) => res.json())
      .then((body) => setLocations(body.data?.locations ?? []));
  }, [warehouseId]);

  const handleWarehouseChange = (id: string) => {
    setWarehouseId(id);
    setWarehouseLocationId("");
    if (!id) setLocations([]);
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Finished Goods Inventory", href: "/finished-goods-inventory" },
          { label: "Stock List", href: "/finished-goods-inventory/stock-list" },
          { label: `${summary.product.styleCode} — ${summary.product.styleName}` },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {summary.product.styleCode} — {summary.product.styleName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Full colour/size and warehouse/location breakdown of this style&apos;s current Finished Goods stock.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total Saleable Stock" value={summary.saleableQuantity.toLocaleString()} />
        <StatTile label="Total Rejected Stock" value={summary.rejectedQuantity.toLocaleString()} />
        <StatTile label="Variants Tracked" value={summary.distinctVariantCount} />
        <StatTile label="Warehouses" value={summary.distinctWarehouseCount} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SearchableSelect
          value={warehouseId}
          onChange={handleWarehouseChange}
          options={warehouses.map((w) => ({ id: w.id, label: w.name ?? w.code ?? "" }))}
          placeholder="Search warehouse…"
          emptyOptionLabel="All Warehouses"
        />
        <select
          value={warehouseLocationId}
          onChange={(e) => setWarehouseLocationId(e.target.value)}
          disabled={!warehouseId}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">All Locations</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.code}
            </option>
          ))}
        </select>
      </div>

      <DataTable<StockRow>
        key={`${productId}-${warehouseId}-${warehouseLocationId}`}
        fetchUrl="/api/v1/finished-goods-inventory/stock-list"
        hideSearch
        extraParams={{ productId, warehouseId, warehouseLocationId }}
        statusFilter={{ options: STOCK_STATUS_OPTIONS, allLabel: "All Stock Statuses" }}
        columns={[
          {
            key: "variant",
            header: "Colour / Size",
            render: (row) => (row.productVariant ? `${row.productVariant.color.name} / ${row.productVariant.size.name}` : "— (unallocated) —"),
          },
          { key: "warehouse", header: "Warehouse", render: (row) => row.warehouse?.name ?? "—" },
          { key: "warehouseLocation", header: "Location", render: (row) => row.warehouseLocation?.code ?? "— (staging) —" },
          { key: "stockStatus", header: "Status", render: (row) => (row.stockStatus === "SALEABLE" ? "Saleable" : "Rejected") },
          { key: "quantityOnHand", header: "Quantity On Hand", render: (row) => Number(row.quantityOnHand).toLocaleString() },
          { key: "updatedAt", header: "Last Updated", render: (row) => new Date(row.updatedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}

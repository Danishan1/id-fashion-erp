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
  product: { styleCode: string; styleName: string } | null;
  productVariant: { color: { name: string }; size: { name: string } } | null;
  warehouse: { code: string; name: string } | null;
  warehouseLocation: { code: string } | null;
}

const STOCK_STATUS_OPTIONS = [
  { value: "SALEABLE", label: "Saleable" },
  { value: "REJECTED", label: "Rejected" },
];

export function FinishedGoodsStockListClient() {
  const [colors, setColors] = useState<Option[]>([]);
  const [sizes, setSizes] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [locations, setLocations] = useState<WarehouseLocationOption[]>([]);

  const [colorId, setColorId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouseLocationId, setWarehouseLocationId] = useState("");

  useEffect(() => {
    fetch("/api/v1/colors?pageSize=200")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/sizes?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSizes(body.data ?? []));
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  // react-hooks/set-state-in-effect — the "clear the dependent Location
  // field when Warehouse changes" reset happens synchronously in the
  // SearchableSelect's own onChange handler below, not in this effect's
  // body (the same established fix pattern this project already uses for
  // every other "clear a dependent field" case). This effect's only job is
  // fetching the new warehouse's own locations once a real id is selected.
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
          { label: "Stock List" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Finished Goods Stock List</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Current on-hand quantity per style, colour/size, warehouse, and location — maintained by the
          Finished Goods ledger. A blank Colour/Size on a row means this stock predates variant tracking —
          see the Dashboard&apos;s Unallocated Legacy Stock callout.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SearchableSelect value={colorId} onChange={setColorId} options={colors.map((c) => ({ id: c.id, label: c.name ?? c.code ?? "" }))} placeholder="Search colour…" emptyOptionLabel="All Colours" />
        <SearchableSelect value={sizeId} onChange={setSizeId} options={sizes.map((s) => ({ id: s.id, label: s.name ?? s.code ?? "" }))} placeholder="Search size…" emptyOptionLabel="All Sizes" />
        <SearchableSelect value={warehouseId} onChange={handleWarehouseChange} options={warehouses.map((w) => ({ id: w.id, label: w.name ?? w.code ?? "" }))} placeholder="Search warehouse…" emptyOptionLabel="All Warehouses" />
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
        key={`${colorId}-${sizeId}-${warehouseId}-${warehouseLocationId}`}
        fetchUrl="/api/v1/finished-goods-inventory/stock-list"
        searchPlaceholder="Search by style name or code…"
        extraParams={{ colorId, sizeId, warehouseId, warehouseLocationId }}
        statusFilter={{ options: STOCK_STATUS_OPTIONS, allLabel: "All Stock Statuses" }}
        columns={[
          { key: "product", header: "Style", render: (row) => (row.product ? `${row.product.styleCode} — ${row.product.styleName}` : "—") },
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

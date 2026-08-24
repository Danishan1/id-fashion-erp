"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";

interface StockBalanceRow {
  id: string;
  quantityOnHand: string;
  updatedAt: string;
  product: { styleName: string; styleCode: string } | null;
  warehouse: { name: string; code: string } | null;
}

interface WarehouseOption {
  id: string;
  name: string;
}

export default function StockBalancesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const params = new URLSearchParams();
  if (warehouseId) params.set("warehouseId", warehouseId);
  const fetchUrl = `/api/v1/inventory/stock-balances${params.toString() ? `?${params.toString()}` : ""}`;
  const exportUrl = `/api/v1/inventory/stock-balances/export/xlsx${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Stock Balances" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stock Balances</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Current on-hand quantity per material and warehouse, maintained by the inventory ledger.
          </p>
        </div>
        <a
          href={exportUrl}
          className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Download Excel
        </a>
      </div>

      <select
        value={warehouseId}
        onChange={(e) => setWarehouseId(e.target.value)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      >
        <option value="">All Warehouses</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>

      <DataTable<StockBalanceRow>
        key={fetchUrl}
        fetchUrl={fetchUrl}
        searchPlaceholder="Search by material name or code…"
        columns={[
          { key: "product", header: "Material", render: (row) => (row.product ? `${row.product.styleName} (${row.product.styleCode})` : "—") },
          { key: "warehouse", header: "Warehouse", render: (row) => row.warehouse?.name ?? "—" },
          { key: "quantityOnHand", header: "Quantity On Hand", render: (row) => Number(row.quantityOnHand).toLocaleString() },
          { key: "updatedAt", header: "Last Updated", render: (row) => new Date(row.updatedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}

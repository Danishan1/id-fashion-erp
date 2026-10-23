"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ViewIcon } from "@/components/ui/icons";

interface FabricStockRow {
  id: string;
  productId: string;
  fabricName: string;
  fabricCode: string;
  unit: string | null;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  rollCount: number;
}

interface WarehouseOption {
  id: string;
  name: string;
}

const qty = (n: number, unit: string | null) => `${n.toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`;

export function FabricStockListClient() {
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  const fetchUrl = `/api/v1/inventory/fabric-stock${warehouseId ? `?warehouseId=${warehouseId}` : ""}`;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Fabric Stock" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Fabric Stock</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Stock per fabric from the inventory ledger. Open a fabric to see it by colour and by roll.
        </p>
      </div>

      <div className="w-64">
        <SearchableSelect
          value={warehouseId}
          onChange={setWarehouseId}
          options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
          placeholder="Search warehouse…"
          emptyOptionLabel="All Warehouses"
        />
      </div>

      <DataTable<FabricStockRow>
        key={fetchUrl}
        fetchUrl={fetchUrl}
        searchPlaceholder="Search by fabric name or code…"
        rowHref={(row) => `/inventory/fabric-stock/${row.productId}${warehouseId ? `?warehouseId=${warehouseId}` : ""}`}
        rowHrefLabel="View"
        rowHrefIcon={<ViewIcon />}
        columns={[
          {
            key: "fabricName",
            header: "Fabric Name",
            render: (row) => (
              <span>
                {row.fabricName} <span className="text-xs text-zinc-500">({row.fabricCode})</span>
              </span>
            ),
          },
          { key: "totalStock", header: "Total Stock", render: (row) => qty(row.totalStock, null) },
          { key: "unit", header: "Unit", render: (row) => row.unit ?? "—" },
          { key: "availableStock", header: "Available Stock", render: (row) => qty(row.availableStock, null) },
          { key: "reservedStock", header: "Reserved Stock", render: (row) => qty(row.reservedStock, null) },
          { key: "rollCount", header: "Rolls", render: (row) => row.rollCount.toLocaleString("en-IN") },
        ]}
      />
    </div>
  );
}

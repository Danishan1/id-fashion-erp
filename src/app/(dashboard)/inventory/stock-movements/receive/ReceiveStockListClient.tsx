"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { MovementStatusBadge, type StockMovementRow } from "../StockMovementsListClient";

/** Receiver side of a raw-material transfer: incoming transfers waiting to be put away. */
export function ReceiveStockListClient() {
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [toWarehouseId, setToWarehouseId] = useState("");

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Stock Movements", href: "/inventory/stock-movements" },
          { label: "Receive Stock" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Receive Stock</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Transfers sent to your warehouse that are still in transit. Open one, pick where each material is put away, and
          receive it. Only then is the stock added to the destination warehouse.
        </p>
      </div>

      <DataTable<StockMovementRow>
        fetchUrl="/api/v1/stock-movements"
        extraParams={{ status: "IN_TRANSIT", movementType: "TRANSFER", toWarehouseId: toWarehouseId || undefined }}
        searchPlaceholder="Search by movement number…"
        rowHref={(row) => `/inventory/stock-movements/${row.id}`}
        toolbar={
          <select
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            aria-label="Destination warehouse"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All destination warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        }
        columns={[
          { key: "movementNumber", header: "Movement #", sortable: true },
          { key: "warehouse", header: "From", render: (row) => row.warehouse?.name ?? "—" },
          { key: "toWarehouse", header: "To", render: (row) => row.toWarehouse?.name ?? "—" },
          { key: "status", header: "Status", render: (row) => <MovementStatusBadge status={row.status} /> },
          { key: "items", header: "Lines", render: (row) => row._count.items },
          { key: "performedBy", header: "Sent By", render: (row) => row.performedBy?.fullName ?? "—" },
          { key: "performedAt", header: "Sent On", sortable: true, render: (row) => new Date(row.performedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}

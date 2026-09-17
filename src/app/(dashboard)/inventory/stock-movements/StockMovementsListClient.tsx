"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
  RETURN_TO_SUPPLIER: "Return to Supplier",
};

interface StockMovementRow {
  id: string;
  movementNumber: string;
  movementType: string;
  performedAt: string;
  warehouse: { name: string } | null;
  toWarehouse: { name: string } | null;
  supplier: { name: string } | null;
  performedBy: { fullName: string } | null;
  _count: { items: number };
}

export function StockMovementsListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Stock Movements" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stock Movements</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Warehouse transfers, stock adjustments, and returns to supplier — every one posted to the inventory ledger.
        </p>
      </div>

      <DataTable<StockMovementRow>
        fetchUrl="/api/v1/stock-movements"
        exportUrl="/api/v1/stock-movements/export/xlsx"
        searchPlaceholder="Search by movement number…"
        rowHref={(row) => `/inventory/stock-movements/${row.id}`}
        newHref="/inventory/stock-movements/new"
        newLabel="New Stock Movement"
        statusFilter={{
          paramName: "movementType",
          allLabel: "All Types",
          options: Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "movementNumber", header: "Movement #", sortable: true },
          {
            key: "movementType",
            header: "Type",
            sortable: true,
            render: (row) => MOVEMENT_TYPE_LABELS[row.movementType] ?? row.movementType,
          },
          {
            key: "warehouse",
            header: "Warehouse(s)",
            render: (row) =>
              row.movementType === "TRANSFER"
                ? `${row.warehouse?.name ?? "—"} → ${row.toWarehouse?.name ?? "—"}`
                : row.movementType === "RETURN_TO_SUPPLIER"
                  ? `${row.warehouse?.name ?? "—"} → ${row.supplier?.name ?? "—"}`
                  : (row.warehouse?.name ?? "—"),
          },
          { key: "items", header: "Lines", render: (row) => row._count.items },
          { key: "performedBy", header: "Performed By", render: (row) => row.performedBy?.fullName ?? "—" },
          { key: "performedAt", header: "Date", sortable: true, render: (row) => new Date(row.performedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}

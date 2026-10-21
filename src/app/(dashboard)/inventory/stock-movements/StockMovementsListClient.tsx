"use client";

import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
  RETURN_TO_SUPPLIER: "Return to Supplier",
};

export const MOVEMENT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  POSTED: { label: "Posted", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  IN_TRANSIT: { label: "In Transit", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  RECEIVED: { label: "Received", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
};

export interface StockMovementRow {
  id: string;
  movementNumber: string;
  movementType: string;
  status: string;
  performedAt: string;
  warehouse: { name: string } | null;
  toWarehouse: { name: string } | null;
  supplier: { name: string } | null;
  performedBy: { fullName: string } | null;
  _count: { items: number };
}

export function MovementStatusBadge({ status }: { status: string }) {
  const meta = MOVEMENT_STATUS_LABELS[status] ?? { label: status, className: "" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>;
}

export function StockMovementsListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Stock Movements" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Stock Movements</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Warehouse transfers, stock adjustments, and returns to supplier — every one posted to the inventory ledger.
          A transfer is sent here and stays In Transit until the receiving warehouse puts it away.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/inventory/stock-movements/receive"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Receive Stock
        </Link>
      </div>

      <DataTable<StockMovementRow>
        fetchUrl="/api/v1/stock-movements"
        exportUrl="/api/v1/stock-movements/export/xlsx"
        searchPlaceholder="Search by movement number…"
        rowHref={(row) => `/inventory/stock-movements/${row.id}`}
        newHref="/inventory/stock-movements/new"
        newLabel="Send / New Stock Movement"
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
          { key: "status", header: "Status", render: (row) => <MovementStatusBadge status={row.status} /> },
          { key: "items", header: "Lines", render: (row) => row._count.items },
          { key: "performedBy", header: "Performed By", render: (row) => row.performedBy?.fullName ?? "—" },
          { key: "performedAt", header: "Date", sortable: true, render: (row) => new Date(row.performedAt).toLocaleString() },
        ]}
      />
    </div>
  );
}

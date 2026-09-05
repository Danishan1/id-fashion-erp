"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface DispatchRow {
  id: string;
  dispatchNumber: string;
  dispatchDate: string;
  status: string;
  salesOrder: { orderNumber: string } | null;
  customer: { name: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  PACKED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  DISPATCHED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  ON_HOLD: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function DispatchListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Dispatch" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Dispatch</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick, pack, and ship confirmed Sales Orders — cartons, Finished-Goods stock, and delivery tracking.
        </p>
      </div>

      <DataTable<DispatchRow>
        fetchUrl="/api/v1/dispatches"
        exportUrl="/api/v1/dispatches/export/xlsx"
        newHref="/dispatch/new"
        newLabel="New Dispatch"
        searchPlaceholder="Search by dispatch number…"
        rowHref={(row) => `/dispatch/${row.id}`}
        columns={[
          { key: "dispatchNumber", header: "Dispatch No." },
          { key: "salesOrder", header: "Sales Order", render: (row) => row.salesOrder?.orderNumber ?? "—" },
          { key: "customer", header: "Customer", render: (row) => row.customer?.name ?? "—" },
          { key: "dispatchDate", header: "Date", render: (row) => row.dispatchDate?.slice(0, 10) },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status] ?? ""}`}>
                {row.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

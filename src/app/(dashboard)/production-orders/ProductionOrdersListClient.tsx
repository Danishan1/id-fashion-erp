"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";

interface ProductionOrderRow {
  id: string;
  orderNumber: string;
  status: keyof typeof STATUS_LABELS;
  plannedQuantity: string;
  priority: string;
  product: { styleName: string; styleCode: string } | null;
  requestedBy: { fullName: string } | null;
  createdAt: string;
}

export function ProductionOrdersListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Production Orders" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Production Orders</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manufacturing work orders — each raises one or more independently-trackable Lots that flow through your
          company&apos;s own configured production stages.
        </p>
      </div>

      <DataTable<ProductionOrderRow>
        fetchUrl="/api/v1/production-orders"
        exportUrl="/api/v1/production-orders/export/xlsx"
        searchPlaceholder="Search by order number…"
        newHref="/production-orders/new"
        newLabel="New Production Order"
        rowHref={(row) => `/production-orders/${row.id}`}
        statusFilter={{
          options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "orderNumber", header: "Order #", sortable: true },
          { key: "product", header: "Style", render: (row) => (row.product ? `${row.product.styleName} (${row.product.styleCode})` : "—") },
          { key: "plannedQuantity", header: "Planned Qty", sortable: true },
          { key: "priority", header: "Priority", sortable: true },
          {
            key: "status",
            header: "Status",
            sortable: true,
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
          { key: "requestedBy", header: "Requested By", render: (row) => row.requestedBy?.fullName ?? "—" },
          { key: "createdAt", header: "Date", sortable: true, render: (row) => new Date(row.createdAt).toLocaleDateString() },
        ]}
      />
    </div>
  );
}

"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";
import { REQUEST_TYPE_LABELS } from "./requestTypeLabels";

interface MaterialRequestRow {
  id: string;
  requestNumber: string;
  requestType: keyof typeof REQUEST_TYPE_LABELS;
  status: keyof typeof STATUS_LABELS;
  createdAt: string;
  department: { name: string } | null;
  warehouse: { name: string } | null;
  salesOrder: { orderNumber: string } | null;
  requestedBy: { fullName: string } | null;
}

export function MaterialRequestsListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Material Requests" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Material Requests</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Internal material needs — checked against stock, issued where available, escalated to Purchasing only on a real shortfall.
        </p>
      </div>

      <DataTable<MaterialRequestRow>
        fetchUrl="/api/v1/material-requests"
        exportUrl="/api/v1/material-requests/export/xlsx"
        searchPlaceholder="Search by request number…"
        newHref="/material-requests/new"
        newLabel="New Material Request"
        rowHref={(row) => `/material-requests/${row.id}`}
        statusFilter={{
          options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "requestNumber", header: "Request #", sortable: true },
          {
            key: "requestType",
            header: "Type",
            sortable: true,
            render: (row) => REQUEST_TYPE_LABELS[row.requestType] ?? row.requestType,
          },
          { key: "department", header: "Department", render: (row) => row.department?.name ?? "—" },
          { key: "warehouse", header: "Request (Warehouse)", render: (row) => row.warehouse?.name ?? "—" },
          { key: "salesOrder", header: "Sales Order", render: (row) => row.salesOrder?.orderNumber ?? "—" },
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
          {
            key: "createdAt",
            header: "Date",
            sortable: true,
            render: (row) => new Date(row.createdAt).toLocaleDateString(),
          },
        ]}
      />
    </div>
  );
}

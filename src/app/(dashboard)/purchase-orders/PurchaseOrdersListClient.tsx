"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/currency";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";

interface PurchaseOrderRow {
  id: string;
  orderNumber: string;
  status: keyof typeof STATUS_LABELS;
  orderDate: string;
  totalAmount: string;
  currencyCode: string;
  supplier: { name: string } | null;
  requestedBy: { fullName: string } | null;
}

export function PurchaseOrdersListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Purchase Orders" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Purchase Orders</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Raw material and fabric purchase orders, from draft through goods receipt.
        </p>
      </div>

      <DataTable<PurchaseOrderRow>
        fetchUrl="/api/v1/purchase-orders"
        searchPlaceholder="Search by order number…"
        newHref="/purchase-orders/new"
        newLabel="New Purchase Order"
        rowHref={(row) => `/purchase-orders/${row.id}`}
        columns={[
          { key: "orderNumber", header: "Order #" },
          { key: "supplier", header: "Supplier", render: (row) => row.supplier?.name ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
          {
            key: "totalAmount",
            header: "Amount",
            render: (row) => `${row.currencyCode} ${formatCurrency(row.totalAmount)}`,
          },
          { key: "requestedBy", header: "Requested By", render: (row) => row.requestedBy?.fullName ?? "—" },
          {
            key: "orderDate",
            header: "Order Date",
            render: (row) => new Date(row.orderDate).toLocaleDateString(),
          },
        ]}
      />
    </div>
  );
}

"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/currency";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";

interface SalesOrderRow {
  id: string;
  orderNumber: string;
  status: keyof typeof STATUS_LABELS;
  orderDate: string;
  totalAmount: string;
  currencyCode: string;
  customer: { name: string } | null;
  buyer: { name: string } | null;
  requestedBy: { fullName: string } | null;
}

export function SalesOrdersListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sales Orders" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Sales Orders</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Customer orders from draft through confirmation and into production.
          </p>
        </div>
      </div>

      <DataTable<SalesOrderRow>
        fetchUrl="/api/v1/sales-orders"
        searchPlaceholder="Search by order number…"
        newHref="/sales-orders/new"
        newLabel="New Sales Order"
        rowHref={(row) => `/sales-orders/${row.id}`}
        columns={[
          { key: "orderNumber", header: "Order #" },
          { key: "customer", header: "Customer", render: (row) => row.customer?.name ?? "—" },
          { key: "buyer", header: "Buyer", render: (row) => row.buyer?.name ?? "—" },
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

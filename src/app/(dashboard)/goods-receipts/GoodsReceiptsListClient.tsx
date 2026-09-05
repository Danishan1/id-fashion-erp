"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";

interface GoodsReceiptRow {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  status: keyof typeof STATUS_LABELS;
  purchaseOrder: { orderNumber: string; supplier: { name: string } } | null;
  receivedBy: { fullName: string } | null;
}

export function GoodsReceiptsListClient() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Goods Receipts" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Goods Receipts</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fabric and raw material shipments received against purchase orders.
        </p>
      </div>

      <DataTable<GoodsReceiptRow>
        fetchUrl="/api/v1/goods-receipts"
        exportUrl="/api/v1/goods-receipts/export/xlsx"
        searchPlaceholder="Search by receipt number…"
        rowHref={(row) => `/goods-receipts/${row.id}`}
        columns={[
          { key: "receiptNumber", header: "Receipt #" },
          { key: "purchaseOrder", header: "Purchase Order", render: (row) => row.purchaseOrder?.orderNumber ?? "—" },
          { key: "supplier", header: "Supplier", render: (row) => row.purchaseOrder?.supplier.name ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
          { key: "receivedBy", header: "Received By", render: (row) => row.receivedBy?.fullName ?? "—" },
          {
            key: "receivedDate",
            header: "Received Date",
            render: (row) => new Date(row.receivedDate).toLocaleDateString(),
          },
        ]}
      />
    </div>
  );
}

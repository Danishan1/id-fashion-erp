"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completed",
  PARTIALLY_REVERSED: "Partially Reversed",
  CANCELLED: "Cancelled",
};

interface GoodsReceiptRow {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  status: string;
  purchaseOrder: { orderNumber: string; supplier: { name: string } } | null;
  receivedBy: { fullName: string } | null;
}

export default function GoodsReceiptsListPage() {
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
        searchPlaceholder="Search by receipt number…"
        rowHref={(row) => `/goods-receipts/${row.id}`}
        columns={[
          { key: "receiptNumber", header: "Receipt #" },
          { key: "purchaseOrder", header: "Purchase Order", render: (row) => row.purchaseOrder?.orderNumber ?? "—" },
          { key: "supplier", header: "Supplier", render: (row) => row.purchaseOrder?.supplier.name ?? "—" },
          { key: "status", header: "Status", render: (row) => STATUS_LABELS[row.status] ?? row.status },
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

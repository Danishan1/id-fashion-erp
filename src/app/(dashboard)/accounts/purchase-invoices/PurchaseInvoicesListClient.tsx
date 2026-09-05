"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../invoiceStatusLabels";

interface PurchaseInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  status: keyof typeof STATUS_LABELS;
  totalAmount: string;
  purchaseOrder: { orderNumber: string } | null;
  supplier: { name: string };
}

export function PurchaseInvoicesListClient() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Purchase Invoices" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Purchase Invoices</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Supplier invoices raised against received purchase orders — partial and repeatable per order —
          or a direct/party bill for a service or expense with no purchase order at all.
        </p>
      </div>

      <DataTable<PurchaseInvoiceRow>
        fetchUrl="/api/v1/purchase-invoices"
        exportUrl="/api/v1/purchase-invoices/export/xlsx"
        newHref="/accounts/purchase-invoices/new"
        newLabel="New Invoice"
        searchPlaceholder="Search by invoice number…"
        rowHref={(row) => `/accounts/purchase-invoices/${row.id}`}
        columns={[
          { key: "invoiceNumber", header: "Invoice No." },
          { key: "supplierInvoiceNumber", header: "Supplier Ref.", render: (row) => row.supplierInvoiceNumber ?? "—" },
          { key: "purchaseOrder", header: "Purchase Order", render: (row) => row.purchaseOrder?.orderNumber ?? "—" },
          { key: "supplier", header: "Supplier", render: (row) => row.supplier?.name ?? "—" },
          { key: "invoiceDate", header: "Date", render: (row) => row.invoiceDate?.slice(0, 10) },
          { key: "totalAmount", header: "Total", render: (row) => Number(row.totalAmount).toFixed(2) },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

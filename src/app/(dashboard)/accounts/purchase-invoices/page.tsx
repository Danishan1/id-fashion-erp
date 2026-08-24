"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface PurchaseInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierInvoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  status: string;
  totalAmount: string;
  purchaseOrder: { orderNumber: string };
  supplier: { name: string };
}

export default function PurchaseInvoicesListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Purchase Invoices" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Purchase Invoices</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Supplier invoices raised against received purchase orders — partial and repeatable per order.
        </p>
      </div>

      <DataTable<PurchaseInvoiceRow>
        fetchUrl="/api/v1/purchase-invoices"
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
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.status === "POSTED"
                    ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : row.status === "CANCELLED"
                      ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                }`}
              >
                {row.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

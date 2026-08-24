"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface SalesInvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  totalAmount: string;
  salesOrder: { orderNumber: string };
  customer: { name: string };
}

export default function SalesInvoicesListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Sales Invoices" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Sales Invoices</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Invoices raised against confirmed sales orders.</p>
      </div>

      <DataTable<SalesInvoiceRow>
        fetchUrl="/api/v1/sales-invoices"
        newHref="/accounts/sales-invoices/new"
        newLabel="New Invoice"
        searchPlaceholder="Search by invoice number…"
        rowHref={(row) => `/accounts/sales-invoices/${row.id}`}
        columns={[
          { key: "invoiceNumber", header: "Invoice No." },
          { key: "salesOrder", header: "Sales Order", render: (row) => row.salesOrder?.orderNumber ?? "—" },
          { key: "customer", header: "Customer", render: (row) => row.customer?.name ?? "—" },
          { key: "invoiceDate", header: "Date", render: (row) => row.invoiceDate?.slice(0, 10) },
          { key: "dueDate", header: "Due", render: (row) => row.dueDate?.slice(0, 10) },
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

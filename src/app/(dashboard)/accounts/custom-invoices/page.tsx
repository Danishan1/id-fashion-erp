"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface CustomInvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  status: string;
  grandTotal: string;
  balanceDue: string;
  customer: { name: string };
  invoiceSeries: { name: string };
}

export default function CustomInvoicesListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Custom Invoices" }]} />
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Custom Invoices</h1>
          <div className="flex items-center gap-4">
            <Link href="/accounts/custom-invoices/credit-notes" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Credit Notes →
            </Link>
            <Link href="/accounts/custom-invoices/client-ledger" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Client Ledger →
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Standalone, ad-hoc bills — not linked to a Sales Order. Use this for quick/direct billing outside the
          normal order-to-invoice flow.
        </p>
      </div>

      <DataTable<CustomInvoiceRow>
        fetchUrl="/api/v1/custom-invoices"
        newHref="/accounts/custom-invoices/new"
        newLabel="New Custom Invoice"
        searchPlaceholder="Search by invoice number…"
        rowHref={(row) => `/accounts/custom-invoices/${row.id}`}
        columns={[
          { key: "invoiceNumber", header: "Invoice No." },
          { key: "invoiceSeries", header: "Series", render: (row) => row.invoiceSeries?.name ?? "—" },
          { key: "customer", header: "Client", render: (row) => row.customer?.name ?? "—" },
          { key: "invoiceType", header: "Type", render: (row) => (row.invoiceType === "TAX_INVOICE" ? "Tax Invoice" : "Proforma Invoice") },
          { key: "invoiceDate", header: "Date", render: (row) => row.invoiceDate?.slice(0, 10) },
          { key: "grandTotal", header: "Grand Total", render: (row) => `₹${Number(row.grandTotal).toFixed(2)}` },
          { key: "balanceDue", header: "Balance Due", render: (row) => `₹${Number(row.balanceDue).toFixed(2)}` },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.status === "CANCELLED"
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

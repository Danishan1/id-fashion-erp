"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS, getDerivedCustomInvoiceStatus } from "./statusLabels";

interface CustomInvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  status: string;
  grandTotal: string;
  paidAmount?: string;
  creditedAmount?: string;
  balanceDue: string;
  customer: { name: string };
  invoiceSeries: { name: string };
}

export function CustomInvoicesListClient() {
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
        exportUrl="/api/v1/custom-invoices/export/xlsx"
        newHref="/accounts/custom-invoices/new"
        newLabel="New Custom Invoice"
        searchPlaceholder="Search by invoice number…"
        rowHref={(row) => `/accounts/custom-invoices/${row.id}`}
        rowActions={(row) => (
          <a
            href={`/api/v1/custom-invoices/${row.id}/pdf`}
            download
            title="Download PDF"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500 hover:underline dark:text-indigo-400"
          >
            PDF
          </a>
        )}
        statusFilter={{
          options: [
            { value: "ISSUED", label: "Issued" },
            { value: "PARTIALLY_PAID", label: "Partially Paid" },
            { value: "PAID", label: "Paid" },
            { value: "CANCELLED", label: "Cancelled" },
          ],
        }}
        columns={[
          { key: "invoiceNumber", header: "Invoice No.", sortable: true },
          { key: "invoiceSeries", header: "Series", render: (row) => row.invoiceSeries?.name ?? "—" },
          { key: "customer", header: "Client", render: (row) => row.customer?.name ?? "—" },
          {
            key: "invoiceType",
            header: "Type",
            sortable: true,
            render: (row) => (row.invoiceType === "TAX_INVOICE" ? "Tax Invoice" : "Proforma Invoice"),
          },
          { key: "invoiceDate", header: "Date", sortable: true, render: (row) => row.invoiceDate?.slice(0, 10) },
          { key: "grandTotal", header: "Grand Total", sortable: true, render: (row) => `₹${Number(row.grandTotal).toFixed(2)}` },
          { key: "balanceDue", header: "Balance Due", sortable: true, render: (row) => `₹${Number(row.balanceDue).toFixed(2)}` },
          {
            key: "status",
            header: "Status",
            sortable: true,
            render: (row) => {
              const derived = getDerivedCustomInvoiceStatus(row);
              return (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[derived]}`}>
                  {STATUS_LABELS[derived] ?? derived}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
}

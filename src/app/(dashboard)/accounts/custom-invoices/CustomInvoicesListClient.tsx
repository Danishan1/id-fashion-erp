"use client";

import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS, getDerivedCustomInvoiceStatus } from "./statusLabels";

interface CustomInvoiceItemRow {
  id: string;
  itemName: string;
  hsnCode?: string | null;
  quantity: string | number;
  unitPrice: string | number;
  gstPercentage: string | number;
  lineTotal: string | number;
}

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
  items?: CustomInvoiceItemRow[];
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
        renderExpandedRow={(row) => (
          <div className="py-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Invoice Items Breakdown ({row.items?.length ?? 0})
              </span>
              <span className="text-xs text-zinc-500">
                Invoice #{row.invoiceNumber} • {row.customer?.name ?? "No Client"}
              </span>
            </div>
            {!row.items || row.items.length === 0 ? (
              <p className="text-xs italic text-zinc-500">No line items recorded for this invoice.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-100/75 text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-1.5">#</th>
                      <th className="px-3 py-1.5">Item Description</th>
                      <th className="px-3 py-1.5">HSN/SAC</th>
                      <th className="px-3 py-1.5 text-right">Qty</th>
                      <th className="px-3 py-1.5 text-right">Unit Rate</th>
                      <th className="px-3 py-1.5 text-right">GST %</th>
                      <th className="px-3 py-1.5 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {row.items.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-400">{idx + 1}</td>
                        <td className="px-3 py-1.5 font-medium text-zinc-800 dark:text-zinc-200">{item.itemName}</td>
                        <td className="px-3 py-1.5 font-mono text-zinc-500">{item.hsnCode || "—"}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-700 dark:text-zinc-300">{Number(item.quantity).toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-700 dark:text-zinc-300">₹{Number(item.unitPrice).toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-700 dark:text-zinc-300">{Number(item.gstPercentage)}%</td>
                        <td className="px-3 py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-100">₹{Number(item.lineTotal).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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

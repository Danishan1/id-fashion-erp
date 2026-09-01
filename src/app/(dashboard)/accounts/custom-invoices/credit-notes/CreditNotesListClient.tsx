"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface CreditNoteRow {
  id: string;
  creditNoteNumber: string;
  creditNoteDate: string;
  type: "OVERALL_DISCOUNT" | "PRODUCT_WISE" | "PRODUCT_RETURN";
  reason: string | null;
  totalAmount: string;
  status: "ISSUED" | "CANCELLED";
  customInvoice: { id: string; invoiceNumber: string; customer: { name: string } };
}

const TYPE_LABELS: Record<string, string> = {
  OVERALL_DISCOUNT: "Overall Discount",
  PRODUCT_WISE: "Product-Wise Reduction",
  PRODUCT_RETURN: "Product Return",
};

const STATUS_LABELS: Record<string, string> = {
  ISSUED: "Issued",
  CANCELLED: "Cancelled",
};

export function CreditNotesListClient() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Custom Invoices", href: "/accounts/custom-invoices" },
            { label: "Credit Notes" },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Custom Invoice — Credit Notes</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every credit note issued across all Custom Invoices, in one place. Click a row to open the invoice it belongs to.
        </p>
      </div>

      <DataTable<CreditNoteRow>
        fetchUrl="/api/v1/custom-invoices/credit-notes"
        searchPlaceholder="Search by credit note or invoice number…"
        rowHref={(row) => `/accounts/custom-invoices/${row.customInvoice.id}`}
        columns={[
          { key: "creditNoteNumber", header: "Credit Note No." },
          { key: "customInvoice", header: "Invoice No.", render: (row) => row.customInvoice.invoiceNumber },
          { key: "customer", header: "Client", render: (row) => row.customInvoice.customer.name },
          { key: "creditNoteDate", header: "Date", render: (row) => row.creditNoteDate?.slice(0, 10) },
          { key: "type", header: "Type", render: (row) => TYPE_LABELS[row.type] ?? row.type },
          { key: "reason", header: "Reason", render: (row) => row.reason ?? "—" },
          { key: "totalAmount", header: "Amount", render: (row) => `₹${Number(row.totalAmount).toFixed(2)}` },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.status === "CANCELLED"
                    ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                }`}
              >
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

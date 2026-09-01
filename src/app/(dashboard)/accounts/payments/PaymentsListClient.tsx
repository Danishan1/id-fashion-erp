"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../simpleDocumentStatusLabels";

interface PaymentRow {
  id: string;
  paymentNumber: string;
  direction: "RECEIPT" | "PAYMENT_OUT";
  paymentDate: string;
  amount: string;
  status: keyof typeof STATUS_LABELS;
  customer: { name: string } | null;
  supplier: { name: string } | null;
}

export function PaymentsListClient() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Payments" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Payments</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Money received from customers or paid to suppliers, allocated against invoices.
        </p>
      </div>

      <DataTable<PaymentRow>
        fetchUrl="/api/v1/payments"
        newHref="/accounts/payments/new"
        newLabel="New Payment"
        searchPlaceholder="Search by payment number…"
        rowHref={(row) => `/accounts/payments/${row.id}`}
        columns={[
          { key: "paymentNumber", header: "Payment No." },
          {
            key: "direction",
            header: "Direction",
            render: (row) => (row.direction === "RECEIPT" ? "Receipt" : "Payment Out"),
          },
          {
            key: "party",
            header: "Party",
            render: (row) => row.customer?.name ?? row.supplier?.name ?? "—",
          },
          { key: "paymentDate", header: "Date", render: (row) => row.paymentDate?.slice(0, 10) },
          { key: "amount", header: "Amount", render: (row) => Number(row.amount).toFixed(2) },
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

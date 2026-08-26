"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface PaymentRow {
  id: string;
  paymentNumber: string;
  direction: "RECEIPT" | "PAYMENT_OUT";
  paymentDate: string;
  amount: string;
  status: string;
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

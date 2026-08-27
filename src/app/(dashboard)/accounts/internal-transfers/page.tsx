"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface InternalTransferRow {
  id: string;
  transferNumber: string;
  transferDate: string;
  amount: string;
  status: string;
  fromPaymentType: { name: string };
  toPaymentType: { name: string };
}

export default function InternalTransfersListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Internal Transfers" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Internal Transfers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Moving money between the company&apos;s own Cash/Bank accounts — zero P&amp;L impact, not an Expense.
        </p>
      </div>

      <DataTable<InternalTransferRow>
        fetchUrl="/api/v1/internal-transfers"
        newHref="/accounts/internal-transfers/new"
        newLabel="New Transfer"
        searchPlaceholder="Search by transfer number…"
        rowHref={(row) => `/accounts/internal-transfers/${row.id}`}
        columns={[
          { key: "transferNumber", header: "Transfer No." },
          { key: "from", header: "From", render: (row) => row.fromPaymentType.name },
          { key: "to", header: "To", render: (row) => row.toPaymentType.name },
          { key: "transferDate", header: "Date", render: (row) => row.transferDate?.slice(0, 10) },
          { key: "amount", header: "Amount", render: (row) => `₹${Number(row.amount).toFixed(2)}` },
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

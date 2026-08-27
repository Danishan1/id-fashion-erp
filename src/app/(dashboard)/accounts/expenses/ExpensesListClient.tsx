"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface ExpenseRow {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  description: string;
  totalAmount: string;
  status: string;
  account: { code: string; name: string } | null;
  supplier: { name: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  APPROVED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  PAID: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export function ExpensesListClient() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Expenses" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Expenses</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Direct day-to-day costs (rent, utilities, salaries, misc.) — not vendor bills with terms, which
          go through Purchase Invoices instead. Created → Admin Approves/Rejects → Accountant Pays.
        </p>
      </div>

      <DataTable<ExpenseRow>
        fetchUrl="/api/v1/expenses"
        newHref="/accounts/expenses/new"
        newLabel="New Expense"
        searchPlaceholder="Search by expense number…"
        rowHref={(row) => `/accounts/expenses/${row.id}`}
        columns={[
          { key: "expenseNumber", header: "Expense No." },
          { key: "description", header: "Description" },
          { key: "account", header: "Account", render: (row) => (row.account ? `${row.account.code} — ${row.account.name}` : "—") },
          { key: "supplier", header: "Supplier", render: (row) => row.supplier?.name ?? "—" },
          { key: "expenseDate", header: "Date", render: (row) => row.expenseDate?.slice(0, 10) },
          { key: "totalAmount", header: "Amount", render: (row) => Number(row.totalAmount).toFixed(2) },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status] ?? ""}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface EmployeeAdvanceRow {
  id: string;
  advanceNumber: string;
  advanceDate: string;
  amount: string;
  settledAmount: string;
  status: string;
  employee: { fullName: string };
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  ISSUED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  PARTIALLY_SETTLED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  SETTLED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function EmployeeAdvancesListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Employee Advances" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Employee Advances</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Advance money to an employee to spend, settle it later against real expense receipts.
        </p>
      </div>

      <DataTable<EmployeeAdvanceRow>
        fetchUrl="/api/v1/employee-advances"
        newHref="/accounts/employee-advances/new"
        newLabel="New Advance"
        searchPlaceholder="Search by advance number…"
        rowHref={(row) => `/accounts/employee-advances/${row.id}`}
        columns={[
          { key: "advanceNumber", header: "Advance No." },
          { key: "employee", header: "Employee", render: (row) => row.employee.fullName },
          { key: "advanceDate", header: "Date", render: (row) => row.advanceDate?.slice(0, 10) },
          { key: "amount", header: "Amount", render: (row) => `₹${Number(row.amount).toFixed(2)}` },
          { key: "settledAmount", header: "Settled", render: (row) => `₹${Number(row.settledAmount).toFixed(2)}` },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status] ?? ""}`}>{row.status}</span>
            ),
          },
        ]}
      />
    </div>
  );
}

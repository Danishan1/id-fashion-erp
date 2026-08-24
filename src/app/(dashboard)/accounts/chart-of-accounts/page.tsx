"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface AccountRow {
  id: string;
  code: string;
  name: string;
  accountType: string;
  parentAccount: { name: string } | null;
  isSystemAccount: boolean;
  isActive: boolean;
}

export default function ChartOfAccountsListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Chart of Accounts" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Chart of Accounts</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Ledger account master used by the journal engine.</p>
      </div>

      <DataTable<AccountRow>
        fetchUrl="/api/v1/chart-of-accounts"
        newHref="/accounts/chart-of-accounts/new"
        newLabel="New Account"
        searchPlaceholder="Search by code or name…"
        rowHref={(row) => `/accounts/chart-of-accounts/${row.id}`}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "accountType", header: "Type" },
          { key: "parentAccount", header: "Parent", render: (row) => row.parentAccount?.name ?? "—" },
          {
            key: "isSystemAccount",
            header: "System",
            render: (row) =>
              row.isSystemAccount ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                  System
                </span>
              ) : (
                "—"
              ),
          },
          {
            key: "isActive",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {row.isActive ? "Active" : "Inactive"}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

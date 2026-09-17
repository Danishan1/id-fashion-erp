"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ChartOfAccountForm } from "./ChartOfAccountForm";

interface AccountRow {
  id: string;
  code: string;
  name: string;
  accountType: string;
  parentAccount: { name: string } | null;
  isSystemAccount: boolean;
  isActive: boolean;
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: "ASSET", label: "Asset" },
  { value: "LIABILITY", label: "Liability" },
  { value: "EQUITY", label: "Equity" },
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
];

export function ChartOfAccountsListClient() {
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const closeModal = () => setModalOpen(false);

  const handleSuccess = () => {
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Chart of Accounts" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Chart of Accounts</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Ledger account master used by the journal engine.</p>
      </div>

      <DataTable<AccountRow>
        fetchUrl="/api/v1/chart-of-accounts"
        refreshKey={refreshKey}
        newAction={{ label: "New Account", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by code or name…"
        rowHref={(row) => `/accounts/chart-of-accounts/${row.id}`}
        statusFilter={{ options: ACCOUNT_TYPE_OPTIONS, allLabel: "All Types" }}
        columns={[
          { key: "code", header: "Code", sortable: true },
          { key: "name", header: "Name", sortable: true },
          { key: "accountType", header: "Type", sortable: true },
          { key: "parentAccount", header: "Parent", render: (row) => row.parentAccount?.name ?? "—" },
          {
            key: "isSystemAccount",
            header: "System",
            sortable: true,
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
            sortable: true,
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

      <Modal open={modalOpen} onClose={closeModal} title="New Account" maxWidthClass="max-w-xl">
        <ChartOfAccountForm submitUrl="/api/v1/chart-of-accounts" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}

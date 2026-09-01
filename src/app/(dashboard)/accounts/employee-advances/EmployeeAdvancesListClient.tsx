"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EmployeeAdvanceForm } from "./new/EmployeeAdvanceForm";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";

interface EmployeeAdvanceRow {
  id: string;
  advanceNumber: string;
  advanceDate: string;
  amount: string;
  settledAmount: string;
  status: keyof typeof STATUS_LABELS;
  employee: { fullName: string };
}

export function EmployeeAdvancesListClient() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const closeModal = () => setModalOpen(false);

  const handleSuccess = () => {
    closeModal();
    setRefreshKey((k) => k + 1);
    router.refresh();
  };

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
        refreshKey={refreshKey}
        newAction={{ label: "New Advance", onClick: () => setModalOpen(true) }}
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
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />

      <Modal open={modalOpen} onClose={closeModal} title="New Employee Advance" maxWidthClass="max-w-2xl">
        <EmployeeAdvanceForm onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}

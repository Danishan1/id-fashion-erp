"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EmployeeForm } from "./EmployeeForm";

interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: { name: string } | null;
  department: { name: string } | null;
  employeeCategory: { name: string } | null;
  workSkills?: Array<{ productionStage: { name: string; sequence: number } }>;
  isActive: boolean;
}

export function EmployeesListClient() {
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const closeModal = () => setModalOpen(false);

  const handleSuccess = () => {
    closeModal();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Employees" }]} />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Employees</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Staff records and departments.</p>
        </div>
        <a href="/masters/hr-config" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          Manage departments →
        </a>
      </div>

      <DataTable<EmployeeRow>
        fetchUrl="/api/v1/employees"
        refreshKey={refreshKey}
        newAction={{ label: "New Employee", onClick: () => setModalOpen(true) }}
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/employees/${row.id}`}
        columns={[
          { key: "employeeCode", header: "Code", sortable: true },
          { key: "fullName", header: "Name", sortable: true },
          { key: "department", header: "Department", render: (row) => row.department?.name ?? "—" },
          { key: "designation", header: "Designation", render: (row) => row.designation?.name ?? "—" },
          { key: "employeeCategory", header: "Category", render: (row) => row.employeeCategory?.name ?? "—" },
          {
            key: "workSkills",
            header: "Work Skills",
            render: (row) =>
              row.workSkills && row.workSkills.length > 0
                ? [...row.workSkills]
                    .sort((a, b) => a.productionStage.sequence - b.productionStage.sequence)
                    .map((w) => w.productionStage.name.trim())
                    .join(", ")
                : "—",
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

      <Modal open={modalOpen} onClose={closeModal} title="Add Employee" maxWidthClass="max-w-xl">
        <EmployeeForm submitUrl="/api/v1/employees" method="POST" onSuccess={handleSuccess} onCancel={closeModal} />
      </Modal>
    </div>
  );
}

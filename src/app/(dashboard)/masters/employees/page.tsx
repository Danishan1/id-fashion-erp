"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: { name: string } | null;
  department: { name: string } | null;
  isActive: boolean;
}

export default function EmployeesListPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Employees" }]} />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Employees</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Staff records and departments.</p>
        </div>
        <a href="/masters/departments" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          Manage departments →
        </a>
      </div>

      <DataTable<EmployeeRow>
        fetchUrl="/api/v1/employees"
        newHref="/masters/employees/new"
        newLabel="New Employee"
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/employees/${row.id}`}
        columns={[
          { key: "employeeCode", header: "Code" },
          { key: "fullName", header: "Name" },
          { key: "department", header: "Department", render: (row) => row.department?.name ?? "—" },
          { key: "designation", header: "Designation", render: (row) => row.designation?.name ?? "—" },
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

"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

export default function WarehousesListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Warehouses" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Warehouses</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Warehouses and their storage locations.</p>
      </div>

      <DataTable<WarehouseRow>
        fetchUrl="/api/v1/warehouses"
        newHref="/masters/warehouses/new"
        newLabel="New Warehouse"
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/warehouses/${row.id}`}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
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

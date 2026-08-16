"use client";

import { DataTable } from "@/components/ui/DataTable";

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  category: string;
  isActive: boolean;
}

export default function SuppliersListPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Suppliers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Fabric, trims, packaging, and service vendors.</p>
      </div>

      <DataTable<SupplierRow>
        fetchUrl="/api/v1/suppliers"
        newHref="/masters/suppliers/new"
        newLabel="New Supplier"
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/suppliers/${row.id}`}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "category", header: "Category" },
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

"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  type: string;
  country: string | null;
  isActive: boolean;
}

export default function CustomersListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Customers" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Customers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Customers and the buyers/brands under them.</p>
      </div>

      <DataTable<CustomerRow>
        fetchUrl="/api/v1/customers"
        newHref="/masters/customers/new"
        newLabel="New Customer"
        searchPlaceholder="Search by name or code…"
        rowHref={(row) => `/masters/customers/${row.id}`}
        columns={[
          { key: "code", header: "Code" },
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "country", header: "Country", render: (row) => row.country ?? "—" },
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

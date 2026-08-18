"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface ProductRow {
  id: string;
  styleCode: string;
  styleName: string;
  category: { name: string } | null;
  season: { name: string } | null;
  isActive: boolean;
  _count: { variants: number };
}

export default function ProductsListPage() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Styles" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Styles</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Product styles with color/size variants.</p>
      </div>

      <DataTable<ProductRow>
        fetchUrl="/api/v1/products"
        newHref="/masters/products/new"
        newLabel="New Style"
        searchPlaceholder="Search by style name or code…"
        rowHref={(row) => `/masters/products/${row.id}`}
        columns={[
          { key: "styleCode", header: "Style Code" },
          { key: "styleName", header: "Name" },
          { key: "category", header: "Category", render: (row) => row.category?.name ?? "—" },
          { key: "season", header: "Season", render: (row) => row.season?.name ?? "—" },
          { key: "variants", header: "Variants", render: (row) => row._count.variants },
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

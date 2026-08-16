"use client";

import { DataTable } from "@/components/ui/DataTable";

interface MaterialRow {
  id: string;
  styleCode: string;
  styleName: string;
  materialCategory: string | null;
  baseUom: { code: string } | null;
  reorderLevel: string | null;
  isActive: boolean;
}

export default function MaterialsListPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Raw Materials</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fabric, trims, accessories, and packaging items used in production.
        </p>
      </div>

      <DataTable<MaterialRow>
        fetchUrl="/api/v1/materials"
        newHref="/masters/materials/new"
        newLabel="New Material"
        searchPlaceholder="Search by name or item code…"
        rowHref={(row) => `/masters/materials/${row.id}`}
        columns={[
          { key: "styleCode", header: "Item Code" },
          { key: "styleName", header: "Name" },
          { key: "materialCategory", header: "Category", render: (row) => row.materialCategory ?? "—" },
          { key: "baseUom", header: "UOM", render: (row) => row.baseUom?.code ?? "—" },
          { key: "reorderLevel", header: "Reorder Level", render: (row) => row.reorderLevel ?? "—" },
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

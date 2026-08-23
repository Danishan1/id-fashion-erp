"use client";

import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";

interface StyleRow {
  id: string;
  styleName: string;
  styleCode: string;
  bomItemCount: number;
}

export default function BomMrpListPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "BOM / MRP" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">BOM / MRP</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Bill of Materials per style, and material requirements planning against Sales Orders.
          </p>
        </div>
        <Link
          href="/bom-mrp/requirements"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Material Requirements
        </Link>
      </div>

      <DataTable<StyleRow>
        fetchUrl="/api/v1/bom-mrp"
        searchPlaceholder="Search by style name or code…"
        rowHref={(row) => `/bom-mrp/${row.id}`}
        columns={[
          { key: "styleName", header: "Style" },
          { key: "styleCode", header: "Code" },
          {
            key: "bomItemCount",
            header: "BOM Lines",
            render: (row) =>
              row.bomItemCount > 0 ? (
                `${row.bomItemCount} line${row.bomItemCount === 1 ? "" : "s"}`
              ) : (
                <span className="text-zinc-400">No BOM yet</span>
              ),
          },
        ]}
      />
    </div>
  );
}

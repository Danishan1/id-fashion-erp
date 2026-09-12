"use client";

import Link from "next/link";
import { useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../sampling/statusLabels";

interface StyleRow {
  id: string;
  styleName: string;
  styleCode: string;
  bomItemCount: number;
}

interface SampleRequestRow {
  id: string;
  requestNumber: string;
  styleName: string | null;
  status: keyof typeof STATUS_LABELS;
  requestDate: string;
  customer: { name: string } | null;
  product: { styleName: string } | null;
}

// "Style" is the existing Style BOM list (Bom/BomItem, once a design has
// graduated into a real Product); "Design BOM" is Sampling's own material
// list per sample — reuses the exact same /api/v1/sampling list endpoint
// the Sampling worklist itself is built on, just projected through the
// generic DataTable instead of that page's own bespoke filter panel, since
// this tab only needs a quick way to reach a design's BOM, not the full
// Sampling worklist experience.
export function BomMrpListClient({ canViewDesignBom }: { canViewDesignBom: boolean }) {
  const [tab, setTab] = useState<"style" | "design">("style");

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

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("style")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "style"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Style
        </button>
        {canViewDesignBom && (
          <button
            type="button"
            onClick={() => setTab("design")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "design"
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Design BOM
          </button>
        )}
      </div>

      {tab === "style" && (
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
      )}

      {tab === "design" && canViewDesignBom && (
        <DataTable<SampleRequestRow>
          fetchUrl="/api/v1/sampling"
          searchPlaceholder="Search by request number…"
          rowHref={(row) => `/bom-mrp/design/${row.id}`}
          columns={[
            { key: "requestNumber", header: "Request #" },
            { key: "styleName", header: "Design Name", render: (row) => row.styleName ?? "—" },
            { key: "product", header: "Style", render: (row) => row.product?.styleName ?? "—" },
            { key: "customer", header: "Customer", render: (row) => row.customer?.name ?? "—" },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              ),
            },
            { key: "requestDate", header: "Request Date", render: (row) => new Date(row.requestDate).toLocaleDateString() },
          ]}
        />
      )}
    </div>
  );
}

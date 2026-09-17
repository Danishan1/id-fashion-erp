"use client";

import { useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { CsvImportModal } from "@/components/ui/CsvImportModal";
import { STAGE_LABELS } from "./statusLabels";

interface DealRow {
  id: string;
  dealNumber: string;
  title: string;
  stage: keyof typeof STAGE_LABELS;
  value: string;
  weightedValue: number;
  lead: { name: string } | null;
  customer: { name: string } | null;
  assignedTo: { fullName: string } | null;
}

export default function DealsListPage() {
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Deals" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Deals</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sales pipeline — deal stage, value, and weighted revenue. A won deal that turns into a real order
            can be linked forward from the Sales Order it produces.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setImportKey((k) => k + 1);
              setImportOpen(true);
            }}
            className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Import from CSV
          </button>
          <Link href="/deals/board" className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Board View →
          </Link>
        </div>
      </div>

      <DataTable<DealRow>
        fetchUrl="/api/v1/deals"
        searchPlaceholder="Search by deal title…"
        newHref="/deals/new"
        newLabel="New Deal"
        rowHref={(row) => `/deals/${row.id}`}
        refreshKey={refreshKey}
        statusFilter={{
          options: Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "dealNumber", header: "Deal #", sortable: true },
          { key: "title", header: "Title", sortable: true },
          { key: "lead", header: "Lead / Customer", render: (row) => row.lead?.name ?? row.customer?.name ?? "—" },
          { key: "stage", header: "Stage", sortable: true, render: (row) => STAGE_LABELS[row.stage] ?? row.stage },
          { key: "value", header: "Value", sortable: true, render: (row) => `₹${Number(row.value).toLocaleString()}` },
          { key: "weightedValue", header: "Weighted", render: (row) => `₹${Number(row.weightedValue).toLocaleString()}` },
          { key: "assignedTo", header: "Owner", render: (row) => row.assignedTo?.fullName ?? "—" },
        ]}
      />

      <CsvImportModal
        key={importKey}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        importType="DEAL"
        title="Import Deals from CSV"
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

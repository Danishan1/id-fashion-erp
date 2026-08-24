"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
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
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Deals" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Deals</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sales pipeline — deal stage, value, and weighted revenue. A won deal that turns into a real order
          can be linked forward from the Sales Order it produces.
        </p>
      </div>

      <DataTable<DealRow>
        fetchUrl="/api/v1/deals"
        searchPlaceholder="Search by deal title…"
        newHref="/deals/new"
        newLabel="New Deal"
        rowHref={(row) => `/deals/${row.id}`}
        columns={[
          { key: "dealNumber", header: "Deal #" },
          { key: "title", header: "Title" },
          { key: "lead", header: "Lead / Customer", render: (row) => row.lead?.name ?? row.customer?.name ?? "—" },
          { key: "stage", header: "Stage", render: (row) => STAGE_LABELS[row.stage] ?? row.stage },
          { key: "value", header: "Value", render: (row) => `₹${Number(row.value).toLocaleString()}` },
          { key: "weightedValue", header: "Weighted", render: (row) => `₹${Number(row.weightedValue).toLocaleString()}` },
          { key: "assignedTo", header: "Owner", render: (row) => row.assignedTo?.fullName ?? "—" },
        ]}
      />
    </div>
  );
}

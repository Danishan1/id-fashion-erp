"use client";

import { useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { CsvImportModal } from "@/components/ui/CsvImportModal";
import { STATUS_LABELS, PRIORITY_LABELS } from "./statusLabels";

interface LeadRow {
  id: string;
  leadNumber: string;
  name: string;
  companyName: string | null;
  status: keyof typeof STATUS_LABELS;
  priority: keyof typeof PRIORITY_LABELS;
  leadScore: string;
  value: string;
  assignedTo: { fullName: string } | null;
}

export default function LeadsListPage() {
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leads</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sales leads with scoring, assignment, and follow-up tracking. A lead that turns into a real style
            enquiry can be linked forward from its own page — Buyer Enquiries and Sales Orders can still be
            created directly without ever going through a Lead.
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
          <Link href="/imports" className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Import History →
          </Link>
        </div>
      </div>

      <DataTable<LeadRow>
        fetchUrl="/api/v1/leads"
        searchPlaceholder="Search by name, email, phone, or company…"
        newHref="/leads/new"
        newLabel="New Lead"
        rowHref={(row) => `/leads/${row.id}`}
        refreshKey={refreshKey}
        statusFilter={{
          options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "leadNumber", header: "Lead #", sortable: true },
          { key: "name", header: "Name", sortable: true, render: (row) => `${row.name}${row.companyName ? ` (${row.companyName})` : ""}` },
          { key: "leadScore", header: "Score", sortable: true, render: (row) => Number(row.leadScore).toFixed(1) },
          { key: "priority", header: "Priority", render: (row) => PRIORITY_LABELS[row.priority] ?? row.priority },
          { key: "value", header: "Potential Value", sortable: true, render: (row) => `₹${Number(row.value).toLocaleString()}` },
          { key: "assignedTo", header: "Assigned To", render: (row) => row.assignedTo?.fullName ?? "—" },
          { key: "status", header: "Status", sortable: true, render: (row) => STATUS_LABELS[row.status] ?? row.status },
        ]}
      />

      <CsvImportModal
        key={importKey}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        importType="LEAD"
        title="Import Leads from CSV"
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

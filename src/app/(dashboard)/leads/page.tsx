"use client";

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
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
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leads" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leads</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sales leads with scoring, assignment, and follow-up tracking. A lead that turns into a real style
          enquiry can be linked forward from its own page — Buyer Enquiries and Sales Orders can still be
          created directly without ever going through a Lead.
        </p>
      </div>

      <DataTable<LeadRow>
        fetchUrl="/api/v1/leads"
        searchPlaceholder="Search by name, email, phone, or company…"
        newHref="/leads/new"
        newLabel="New Lead"
        rowHref={(row) => `/leads/${row.id}`}
        columns={[
          { key: "leadNumber", header: "Lead #" },
          { key: "name", header: "Name", render: (row) => `${row.name}${row.companyName ? ` (${row.companyName})` : ""}` },
          { key: "leadScore", header: "Score", render: (row) => Number(row.leadScore).toFixed(1) },
          { key: "priority", header: "Priority", render: (row) => PRIORITY_LABELS[row.priority] ?? row.priority },
          { key: "value", header: "Potential Value", render: (row) => `₹${Number(row.value).toLocaleString()}` },
          { key: "assignedTo", header: "Assigned To", render: (row) => row.assignedTo?.fullName ?? "—" },
          { key: "status", header: "Status", render: (row) => STATUS_LABELS[row.status] ?? row.status },
        ]}
      />
    </div>
  );
}

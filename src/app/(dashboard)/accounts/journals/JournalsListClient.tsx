"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../simpleDocumentStatusLabels";

interface JournalRow {
  id: string;
  journalNumber: string;
  journalDate: string;
  status: keyof typeof STATUS_LABELS;
  narration: string | null;
  totalDebit: string;
  totalCredit: string;
  createdBy: { fullName: string };
}

export function JournalsListClient() {
  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Journals" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Journals</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Manual double-entry journal entries.</p>
      </div>

      <DataTable<JournalRow>
        fetchUrl="/api/v1/journals"
        newHref="/accounts/journals/new"
        newLabel="New Journal"
        searchPlaceholder="Search by journal number…"
        rowHref={(row) => `/accounts/journals/${row.id}`}
        columns={[
          { key: "journalNumber", header: "Journal No." },
          { key: "journalDate", header: "Date", render: (row) => row.journalDate?.slice(0, 10) },
          { key: "narration", header: "Narration", render: (row) => row.narration ?? "—" },
          { key: "totalDebit", header: "Debit", render: (row) => Number(row.totalDebit).toFixed(2) },
          { key: "totalCredit", header: "Credit", render: (row) => Number(row.totalCredit).toFixed(2) },
          { key: "createdBy", header: "Created By", render: (row) => row.createdBy?.fullName ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

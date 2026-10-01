"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { RowStatusBadge } from "./ImportBadges";
import type { ImportRowDto } from "./import-types";

export type RowFilter = "all" | "problems" | "ERROR" | "WARNING" | "duplicates" | "IMPORTED" | "UPDATED" | "SKIPPED" | "FLAGGED" | "FAILED";

const PREVIEW_FILTERS: { id: RowFilter; label: string }[] = [
  { id: "all", label: "All rows" },
  { id: "ERROR", label: "Errors" },
  { id: "WARNING", label: "Warnings" },
  { id: "duplicates", label: "Possible duplicates" },
];
const RESULT_FILTERS: { id: RowFilter; label: string }[] = [
  { id: "all", label: "All rows" },
  { id: "problems", label: "Needs attention" },
  { id: "IMPORTED", label: "Imported" },
  { id: "UPDATED", label: "Updated" },
  { id: "SKIPPED", label: "Skipped" },
  { id: "FLAGGED", label: "Flagged" },
  { id: "FAILED", label: "Failed" },
];

function paramsFor(filter: RowFilter): Record<string, string | undefined> {
  if (filter === "ERROR" || filter === "WARNING") return { validation: filter };
  if (filter === "duplicates") return { duplicates: "only" };
  if (filter === "problems") return { problems: "only" };
  if (filter === "all") return {};
  return { outcome: filter };
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function nameOf(r: ImportRowDto) {
  const m = r.mapped ?? {};
  return [str(m.firstName), str(m.lastName)].filter(Boolean).join(" ") || Object.values(r.raw).find(Boolean) || "—";
}
function contactOf(r: ImportRowDto) {
  const m = r.mapped ?? {};
  return [str(m.email), str(m.mobile) ?? str(m.phone) ?? str(m.whatsapp)].filter(Boolean).join(" · ") || "—";
}

function Details({ r }: { r: ImportRowDto }) {
  const items: ReactNode[] = [];
  if (r.outcomeReason) items.push(<li key="reason" className="font-medium text-zinc-800 dark:text-zinc-100">{r.outcomeReason}</li>);
  r.messages
    .filter((m) => !(r.outcomeReason && m.level === "error" && r.outcomeReason === m.message))
    .forEach((m, i) =>
      items.push(
        <li key={i} className={m.level === "error" ? "text-red-700 dark:text-red-400" : m.level === "warning" ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-300"}>
          {m.message}
        </li>
      )
    );
  if (!items.length) return <span className="text-zinc-400">—</span>;
  return <ul className="max-w-xl space-y-0.5 text-xs">{items}</ul>;
}

export function ImportRowsTable({
  jobId,
  mode,
  filter,
  onFilterChange,
  refreshKey,
  selection,
  toolbar,
}: {
  jobId: string;
  mode: "preview" | "result";
  filter: RowFilter;
  onFilterChange: (f: RowFilter) => void;
  refreshKey?: number;
  selection?: { selectedIds: string[]; onChange: (ids: string[]) => void };
  toolbar?: ReactNode;
}) {
  const filters = mode === "preview" ? PREVIEW_FILTERS : RESULT_FILTERS;
  const columns: DataTableColumn<ImportRowDto>[] = [
    { key: "rowNumber", header: "Row", render: (r) => <span className="tabular-nums text-zinc-500">{r.rowNumber}</span> },
    { key: "name", header: "Name", render: (r) => <span className="font-medium">{nameOf(r)}</span> },
    { key: "company", header: "Company", render: (r) => str(r.mapped?.companyName) ?? "—" },
    { key: "contact", header: "Email / phone", render: (r) => <span className="whitespace-nowrap">{contactOf(r)}</span> },
    { key: "status", header: "Status", render: (r) => <RowStatusBadge row={r} /> },
    { key: "details", header: "Details", render: (r) => <Details r={r} /> },
    ...(mode === "result"
      ? [
          {
            key: "lead",
            header: "Lead",
            render: (r: ImportRowDto) =>
              r.lead ? (
                <Link href={`/crm/leads/${r.lead.id}`} className="whitespace-nowrap text-indigo-600 hover:underline dark:text-indigo-400">
                  {r.lead.leadNumber}
                </Link>
              ) : (
                "—"
              ),
          },
        ]
      : []),
  ];
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Row filter" className="flex flex-wrap gap-1">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => onFilterChange(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === f.id ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <DataTable<ImportRowDto>
        key={`${jobId}-${filter}`}
        fetchUrl={`/api/v1/crm/imports/${jobId}/rows`}
        columns={columns}
        extraParams={paramsFor(filter)}
        hideSearch
        refreshKey={refreshKey}
        toolbar={toolbar}
        selection={selection ? { ...selection, label: (r) => `row ${r.rowNumber}` } : undefined}
      />
    </div>
  );
}

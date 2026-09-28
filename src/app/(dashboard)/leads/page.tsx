"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LEAD_SEGMENT_LABELS, isLeadSegment } from "@/modules/crm/lead-segment-labels";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { CsvImportModal } from "@/components/ui/CsvImportModal";
import {
  LEAD_PRIORITY_BADGE_CLASS,
  LEAD_PRIORITY_LABELS,
  QUALITY_BADGE_CLASS,
  QUALITY_LABELS,
  STAGE_KIND_BADGE_CLASS,
  type StageKind,
} from "./statusLabels";

interface LeadRow {
  id: string;
  leadNumber: string;
  name: string;
  companyName: string | null;
  country: string | null;
  stage: { id: string; name: string; kind: StageKind };
  source: { name: string } | null;
  quality: keyof typeof QUALITY_LABELS;
  priority: keyof typeof LEAD_PRIORITY_LABELS;
  value: string;
  daysInCurrentStage: number;
  daysSinceLastActivity: number | null;
  assignedTo: { fullName: string } | null;
}

interface StageOption {
  id: string;
  name: string;
}

/** URL filters this list understands — the CRM dashboard links here with
 * these so every card opens exactly the records it counted. */
const URL_FILTERS = ["segment", "stageId", "sourceId", "assignedToUserId", "priority", "country", "createdFrom", "createdTo"] as const;

export default function LeadsListPage() {
  return (
    <Suspense>
      <LeadsList />
    </Suspense>
  );
}

function LeadsList() {
  const searchParams = useSearchParams();
  const active = URL_FILTERS.map((k) => [k, searchParams.get(k)] as const).filter((e): e is readonly [(typeof URL_FILTERS)[number], string] => !!e[1]);
  const query = new URLSearchParams(active.map(([k, v]) => [k, v])).toString();
  const fetchUrl = `/api/v1/leads${query ? `?${query}` : ""}`;
  const [importOpen, setImportOpen] = useState(false);
  const [importKey, setImportKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stages, setStages] = useState<StageOption[]>([]);

  useEffect(() => {
    fetch("/api/v1/crm/pipeline-stages?activeOnly=true")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setStages(body?.data ?? []))
      .catch(() => setStages([]));
  }, []);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "CRM", href: "/crm" }, { label: "Leads" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leads</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Every enquiry — who the buyer is, what they want, where it stands, and who is responsible for the next step.
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

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
          <span className="font-medium">Filtered:</span>
          {active.map(([k, v]) => (
            <span key={k} className="rounded bg-white px-2 py-0.5 text-xs dark:bg-zinc-900">
              {k === "segment"
                ? (isLeadSegment(v) ? LEAD_SEGMENT_LABELS[v] : v)
                : k === "stageId"
                  ? `Stage: ${stages.find((s) => s.id === v)?.name ?? "selected"}`
                  : k === "createdFrom"
                    ? `Created from ${v}`
                    : k === "createdTo"
                      ? `Created to ${v}`
                      : k === "assignedToUserId"
                        ? "Selected salesperson"
                        : k === "sourceId"
                          ? "Selected source"
                          : `${k}: ${v}`}
            </span>
          ))}
          <Link href="/leads" className="ml-auto text-xs font-medium underline">
            Clear filters
          </Link>
        </div>
      )}

      <DataTable<LeadRow>
        key={`${stages.length}-${query}`}
        fetchUrl={fetchUrl}
        searchPlaceholder="Search lead #, company, contact, email, phone, WhatsApp, country…"
        newHref="/leads/new"
        newLabel="New Lead"
        rowHref={(row) => `/leads/${row.id}`}
        refreshKey={refreshKey}
        statusFilter={{ options: stages.map((s) => ({ value: s.id, label: s.name })) }}
        columns={[
          { key: "leadNumber", header: "Lead #", sortable: true },
          {
            key: "companyName",
            header: "Company / Contact",
            sortable: true,
            render: (row) => (
              <div>
                <div className="font-medium">{row.companyName ?? row.name}</div>
                {row.companyName && <div className="text-xs text-zinc-500">{row.name}</div>}
              </div>
            ),
          },
          { key: "country", header: "Country", sortable: true, render: (row) => row.country ?? "—" },
          {
            key: "stage",
            header: "Stage",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_KIND_BADGE_CLASS[row.stage.kind]}`}>{row.stage.name}</span>
            ),
          },
          {
            key: "quality",
            header: "Quality",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${QUALITY_BADGE_CLASS[row.quality]}`}>{QUALITY_LABELS[row.quality]}</span>
            ),
          },
          {
            key: "priority",
            header: "Priority",
            sortable: true,
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_PRIORITY_BADGE_CLASS[row.priority]}`}>
                {LEAD_PRIORITY_LABELS[row.priority]}
              </span>
            ),
          },
          { key: "source", header: "Source", render: (row) => row.source?.name ?? "—" },
          { key: "value", header: "Expected Value", sortable: true, render: (row) => `₹${Number(row.value).toLocaleString()}` },
          { key: "assignedTo", header: "Salesperson", render: (row) => row.assignedTo?.fullName ?? "—" },
          {
            key: "daysSinceLastActivity",
            header: "Last Activity",
            render: (row) =>
              row.daysSinceLastActivity === null ? (
                <span className="text-xs font-medium text-red-600 dark:text-red-400">Never contacted</span>
              ) : (
                `${row.daysSinceLastActivity}d ago`
              ),
          },
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { CrmDrawer } from "@/components/crm/CrmDrawer";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { ImportStatusBadge } from "./ImportBadges";
import type { ImportJobDto } from "./import-types";

const n = (v: number) => v.toLocaleString("en-IN");

const JOB_COLUMNS: DataTableColumn<ImportJobDto>[] = [
  {
    key: "fileName",
    header: "File",
    render: (j) => (
      <div className="min-w-[10rem]">
        <Link href={`/crm/leads/imports/${j.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {j.fileName}
        </Link>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{j.id.slice(0, 8)}</div>
      </div>
    ),
  },
  { key: "source", header: "Source", render: (j) => j.source?.name ?? "Import" },
  { key: "createdBy", header: "Uploaded by", render: (j) => j.createdBy.fullName },
  { key: "createdAt", header: "Date", sortable: true, render: (j) => <ClientDateTime value={j.createdAt} /> },
  { key: "totalRows", header: "Rows", render: (j) => n(j.totalRows) },
  { key: "imported", header: "Imported", render: (j) => n(j.importedRows) },
  { key: "updated", header: "Updated", render: (j) => n(j.updatedRows) },
  { key: "skipped", header: "Skipped", render: (j) => n(j.skippedRows) },
  { key: "flagged", header: "Flagged", render: (j) => (j.flaggedRows ? <span className="font-medium text-amber-700 dark:text-amber-400">{n(j.flaggedRows)}</span> : "0") },
  { key: "failed", header: "Failed", render: (j) => (j.failedRows ? <span className="font-medium text-red-700 dark:text-red-400">{n(j.failedRows)}</span> : "0") },
  { key: "status", header: "Status", render: (j) => <ImportStatusBadge status={j.status} /> },
];

interface EventRow {
  id: string;
  channel: string;
  provider: string;
  status: "RECEIVED" | "PROCESSED" | "FLAGGED" | "FAILED";
  outcome: string;
  outcomeReason: string | null;
  attempts: number;
  nextRetryAt: string | null;
  receivedAt: string;
  externalLeadId: string | null;
  idempotencyKey: string | null;
  apiKey: { name: string; prefix: string } | null;
  webhookEndpoint: { name: string } | null;
  lead: { id: string; leadNumber: string; fullName: string } | null;
}
const EVENT_TONE: Record<EventRow["status"], CrmBadgeTone> = { RECEIVED: "neutral", PROCESSED: "green", FLAGGED: "amber", FAILED: "red" };
const CHANNEL: Record<string, string> = { API: "API", WEBSITE_FORM: "Website form", WEBHOOK: "Webhook", INTEGRATION: "Integration" };

function EventDrawer({ id, onClose, canEdit, onChanged }: { id: string; onClose: () => void; canEdit: boolean; onChanged: () => void }) {
  const [ev, setEv] = useState<(EventRow & { received: unknown; mapped: Record<string, unknown> | null; lastError: string | null }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    crmRequest<NonNullable<typeof ev>>(`/api/v1/crm/ingest-events/${id}`).then((r) => {
      if (cancelled) return;
      if (r.ok) setEv(r.data);
      else setError(r.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    const r = await crmRequest(`/api/v1/crm/ingest-events/${id}/${path}`, { method: "POST", body, successMessage: "Done." });
    setBusy(false);
    if (r.ok) {
      onChanged();
      onClose();
    }
  };
  return (
    <CrmDrawer open onClose={onClose} title="Submission">
      {error ? (
        <CrmErrorState message={error} />
      ) : !ev ? (
        <CrmLoadingState />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <CrmBadge label={ev.status} tone={EVENT_TONE[ev.status]} />
            <span>{CHANNEL[ev.channel] ?? ev.channel}</span>
            <span className="text-zinc-500">
              · <ClientDateTime value={ev.receivedAt} />
            </span>
          </div>
          {ev.outcomeReason && <p className="text-zinc-800 dark:text-zinc-100">{ev.outcomeReason}</p>}
          {ev.lead && (
            <Link href={`/crm/leads/${ev.lead.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {ev.lead.leadNumber} · {ev.lead.fullName}
            </Link>
          )}
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-zinc-500">Sent by</dt>
            <dd>{ev.apiKey ? `API key ${ev.apiKey.name}` : ev.webhookEndpoint ? `Webhook ${ev.webhookEndpoint.name}` : "Signed-in user"}</dd>
            <dt className="text-zinc-500">Idempotency key</dt>
            <dd className="break-all">{ev.idempotencyKey ?? "—"}</dd>
            <dt className="text-zinc-500">External lead id</dt>
            <dd className="break-all">{ev.externalLeadId ?? "—"}</dd>
            <dt className="text-zinc-500">Attempts</dt>
            <dd>
              {ev.attempts}
              {ev.nextRetryAt ? (
                <>
                  {" "}
                  · next retry <ClientDateTime value={ev.nextRetryAt} />
                </>
              ) : null}
            </dd>
          </dl>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-zinc-500">Mapped fields</p>
            <pre className="max-h-48 overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{JSON.stringify(ev.mapped, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-zinc-500">Received (secrets hidden)</p>
            <pre className="max-h-64 overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{JSON.stringify(ev.received, null, 2)}</pre>
          </div>
          {canEdit && ev.status === "FLAGGED" && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => act("review", { action: "CREATE" })} isLoading={busy}>
                Create new lead
              </Button>
              <Button variant="secondary" onClick={() => act("review", { action: "UPDATE" })} disabled={busy}>
                Update matching lead
              </Button>
              <Button variant="secondary" onClick={() => act("review", { action: "SKIP" })} disabled={busy}>
                Skip
              </Button>
            </div>
          )}
          {canEdit && ev.status === "FAILED" && (
            <Button variant="secondary" onClick={() => act("retry")} isLoading={busy}>
              Retry now
            </Button>
          )}
        </div>
      )}
    </CrmDrawer>
  );
}

export function ImportHistoryClient({ canSeeSubmissions, canEditSettings }: { canSeeSubmissions: boolean; canEditSettings: boolean }) {
  const [tab, setTab] = useState<"files" | "submissions">("files");
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [eventStatus, setEventStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const eventColumns: DataTableColumn<EventRow>[] = [
    { key: "receivedAt", header: "Received", render: (e) => <ClientDateTime value={e.receivedAt} /> },
    { key: "channel", header: "Channel", render: (e) => CHANNEL[e.channel] ?? e.channel },
    { key: "from", header: "From", render: (e) => (e.apiKey ? `API key ${e.apiKey.name}` : e.webhookEndpoint ? `Webhook ${e.webhookEndpoint.name}` : "Signed-in user") },
    { key: "status", header: "Status", render: (e) => <CrmBadge label={e.status === "PROCESSED" ? e.outcome : e.status} tone={EVENT_TONE[e.status]} /> },
    { key: "lead", header: "Lead", render: (e) => (e.lead ? e.lead.leadNumber : "—") },
    { key: "reason", header: "Details", render: (e) => <span className="line-clamp-2 max-w-md text-xs text-zinc-600 dark:text-zinc-300">{e.outcomeReason ?? "—"}</span> },
  ];
  return (
    <div className="space-y-4">
      {canSeeSubmissions && (
        <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {(
            [
              ["files", "File imports"],
              ["submissions", "API & webhook submissions"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "files" ? (
        <DataTable<ImportJobDto> fetchUrl="/api/v1/crm/imports" columns={JOB_COLUMNS} hideSearch newHref="/crm/leads/import" newLabel="Import leads" rowHref={(j) => `/crm/leads/imports/${j.id}`} />
      ) : (
        <DataTable<EventRow>
          fetchUrl="/api/v1/crm/ingest-events"
          columns={eventColumns}
          hideSearch
          refreshKey={refreshKey}
          extraParams={{ status: eventStatus || undefined }}
          toolbar={
            <select aria-label="Status" value={eventStatus} onChange={(e) => setEventStatus(e.target.value)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <option value="">All statuses</option>
              <option value="PROCESSED">Processed</option>
              <option value="FLAGGED">Flagged</option>
              <option value="FAILED">Failed</option>
            </select>
          }
          rowActions={(e) => (
            <button type="button" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpenEvent(e.id)}>
              View
            </button>
          )}
        />
      )}
      {openEvent && <EventDrawer key={openEvent} id={openEvent} onClose={() => setOpenEvent(null)} canEdit={canEditSettings} onChanged={() => setRefreshKey((k) => k + 1)} />}

    </div>
  );
}

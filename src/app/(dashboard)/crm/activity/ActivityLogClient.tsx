"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmDrawer } from "@/components/crm/CrmDrawer";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { CrmRecordHeader } from "@/components/crm/CrmRecordHeader";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { crmEventTone, type CrmTimelineEventDto } from "@/components/crm/crm-timeline-types";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { readApiError } from "@/lib/api-client";
import { CRM_ENTITY_TYPE_CONFIG, CRM_ENTITY_TYPES } from "@/modules/crm/core/crm-entity-types";
import { CRM_EVENT_TYPES, CRM_EVENT_TYPE_NAMES } from "@/modules/crm/core/crm-event-types";

const FILTERS: CrmFilterDefinition[] = [
  {
    type: "select",
    key: "entityType",
    label: "Record type",
    options: CRM_ENTITY_TYPES.map((t) => ({ value: t, label: CRM_ENTITY_TYPE_CONFIG[t].label })),
  },
  {
    type: "select",
    key: "eventType",
    label: "Event",
    options: CRM_EVENT_TYPE_NAMES.map((t) => ({ value: t, label: CRM_EVENT_TYPES[t].label })),
  },
  { type: "dateRange", label: "Date", fromKey: "from", toKey: "to" },
];

const TONE_TO_BADGE = { neutral: "neutral", indigo: "indigo", green: "green", amber: "amber", red: "red" } as const;

const COLUMNS: DataTableColumn<CrmTimelineEventDto>[] = [
  { key: "occurredAt", header: "When", sortable: true, render: (e) => <ClientDateTime value={e.occurredAt} /> },
  { key: "eventType", header: "Event", render: (e) => <CrmBadge label={e.label} tone={TONE_TO_BADGE[crmEventTone(e.category)]} /> },
  {
    key: "entityType",
    header: "Record",
    render: (e) =>
      e.entityHref ? (
        <Link href={e.entityHref} className="text-indigo-600 hover:underline dark:text-indigo-400">
          {e.entityLabel}
        </Link>
      ) : (
        e.entityLabel
      ),
  },
  { key: "summary", header: "Summary", render: (e) => e.summary ?? "—" },
  { key: "actor", header: "By", render: (e) => e.actor?.fullName ?? "System" },
];

function EventDetail({ id }: { id: string }) {
  const [event, setEvent] = useState<CrmTimelineEventDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/crm/events/${id}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error((await readApiError(res, "Could not load this event.")).message);
        const body = (await res.json()) as { data: CrmTimelineEventDto };
        setError(null);
        setEvent(body.data);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [id, tick]);

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!event) return <CrmLoadingState />;

  return (
    <div className="space-y-5">
      <CrmRecordHeader
        title={event.label}
        subtitle={event.summary ?? undefined}
        badges={[{ label: event.entityLabel, tone: TONE_TO_BADGE[crmEventTone(event.category)] }]}
        metaColumns={2}
        meta={[
          { label: "When", value: <ClientDateTime value={event.occurredAt} /> },
          { label: "By", value: event.actor?.fullName ?? "System" },
          { label: "Event type", value: <code className="text-xs">{event.eventType}</code> },
          {
            label: "Record",
            value: event.entityHref ? (
              <Link href={event.entityHref} className="text-indigo-600 hover:underline dark:text-indigo-400">
                Open {event.entityLabel.toLowerCase()}
              </Link>
            ) : (
              <span className="text-zinc-500">No page yet</span>
            ),
          },
        ]}
      />
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Details</h3>
        {event.payload ? (
          <pre className="max-h-80 overflow-auto rounded-md bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No additional details were recorded for this event.</p>
        )}
      </div>
      <dl className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <div>
          <dt className="inline">Record ID: </dt>
          <dd className="inline font-mono">{event.entityId}</dd>
        </div>
        {event.correlationId && (
          <div>
            <dt className="inline">Request ID: </dt>
            <dd className="inline font-mono">{event.correlationId}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function ActivityLogClient() {
  const [selected, setSelected] = useState<CrmTimelineEventDto | null>(null);

  return (
    <>
      <CrmTable<CrmTimelineEventDto>
        fetchUrl="/api/v1/crm/events"
        columns={COLUMNS}
        filters={FILTERS}
        searchPlaceholder="Search summary or event…"
        onRowClick={setSelected}
      />
      <CrmDrawer open={selected !== null} onClose={() => setSelected(null)} title="Activity details">
        {selected && <EventDetail key={selected.id} id={selected.id} />}
      </CrmDrawer>
    </>
  );
}

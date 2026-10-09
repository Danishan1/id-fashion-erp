"use client";

import { useEffect, useState } from "react";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { AppointmentDetailModal, AppointmentStatusBadge, appointmentWhen } from "./AppointmentDetail";
import { AppointmentForm } from "./AppointmentForm";
import { APPOINTMENTS_API, type AppointmentDto, type AppointmentPrefill } from "./appointment-types";
import { useAppointmentLookups } from "./useAppointmentLookups";

type Parent = { entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY"; entityId: string; label: string };
const FILTER_KEY = { CONTACT: "contactId", COMPANY: "companyId", OPPORTUNITY: "opportunityId" } as const;

/**
 * Appointments of one contact / company / opportunity: upcoming and past,
 * "+ Appointment" pre-filled with the record, and the detail dialog with
 * reschedule / cancel / complete / no-show. The same appointments also show
 * in the record's activities and timeline.
 */
export function AppointmentPanel({ parent, canCreate, canEdit, currentUserId, onChanged, pageSize = 5 }: { parent: Parent; canCreate: boolean; canEdit: boolean; currentUserId: string; onChanged?: () => void; pageSize?: number }) {
  const { meta, users } = useAppointmentLookups();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [limit, setLimit] = useState(pageSize);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<{ key: string; rows: AppointmentDto[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const key = `${parent.entityId}:${tab}:${limit}:${tick}`;

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ [FILTER_KEY[parent.entityType]]: parent.entityId, when: tab, sortBy: "startAt", sortOrder: tab === "upcoming" ? "asc" : "desc", pageSize: String(limit) });
    fetch(`${APPOINTMENTS_API}?${qs}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) return setError(body?.error?.message ?? body?.message ?? "Couldn't load appointments.");
        setError(null);
        setData({ key, rows: body.data ?? [], total: body.meta?.totalCount ?? body.data?.length ?? 0 });
      })
      .catch(() => !cancelled && setError("Couldn't load appointments."));
    return () => {
      cancelled = true;
    };
  }, [parent.entityType, parent.entityId, tab, limit, tick, key]);

  const changed = () => {
    setTick((t) => t + 1);
    onChanged?.();
  };
  const prefill: AppointmentPrefill = { [parent.entityType.toLowerCase()]: { id: parent.entityId, label: parent.label } } as AppointmentPrefill;
  const loading = !data || data.key !== key;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Appointments" className="flex gap-3 text-sm">
          {(["upcoming", "past"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setLimit(pageSize);
              }}
              className={`border-b-2 px-1 pb-1 ${tab === t ? "border-indigo-600 font-medium text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              {t === "upcoming" ? "Upcoming" : "Past"}
            </button>
          ))}
        </div>
        {canCreate && (
          <Button size="xs" variant="secondary" disabled={!meta} onClick={() => setCreating(true)}>
            + Appointment
          </Button>
        )}
      </div>
      {error ? (
        <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
      ) : loading ? (
        <CrmLoadingState />
      ) : data.rows.length === 0 ? (
        <CrmEmptyState title={tab === "upcoming" ? "No upcoming appointments" : "No past appointments"} description={tab === "upcoming" ? "Schedule a demo, visit or meeting." : "Completed, cancelled and missed appointments appear here."} />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.rows.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-2">
              <button type="button" onClick={() => setOpened(a.id)} className="min-w-0 text-left">
                <span className="block truncate text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{a.title}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {appointmentWhen(a, a.timezone)} · {a.assignedTo?.fullName ?? "Unassigned"}
                  {a.location ? ` · ${a.location}` : ""}
                </span>
              </button>
              <AppointmentStatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
      {data && data.key === key && data.total > data.rows.length && (
        <button type="button" onClick={() => setLimit((l) => l + pageSize)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Show more
        </button>
      )}
      {creating && meta && (
        <AppointmentForm
          meta={meta}
          users={users}
          currentUserId={currentUserId}
          prefill={prefill}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setTab("upcoming");
            changed();
          }}
        />
      )}
      {opened && meta && <AppointmentDetailModal appointmentId={opened} meta={meta} users={users} currentUserId={currentUserId} canEdit={canEdit} onClose={() => setOpened(null)} onChanged={changed} />}
    </div>
  );
}

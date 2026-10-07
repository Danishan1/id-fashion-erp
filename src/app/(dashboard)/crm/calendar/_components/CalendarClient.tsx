"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppointmentDetailModal, AppointmentStatusBadge, appointmentWhen } from "@/components/crm/appointments/AppointmentDetail";
import { AppointmentForm, ConflictNotice } from "@/components/crm/appointments/AppointmentForm";
import { APPOINTMENTS_API, type AppointmentDto, type AppointmentPrefill, type ConflictDto } from "@/components/crm/appointments/appointment-types";
import { calendarRange, CrmCalendar, periodLabel, shiftDate, type CalendarEvent, type CalendarTone, type CalendarView } from "@/components/crm/appointments/CrmCalendar";
import { useAppointmentLookups } from "@/components/crm/appointments/useAppointmentLookups";
import { crmRequest } from "@/components/crm/crm-api";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { CrmTable } from "@/components/crm/CrmTable";
import { useCrmListState } from "@/components/crm/useCrmListState";
import { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { Button } from "@/components/ui/Button";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toast } from "@/components/ui/Toast";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/modules/crm/appointments/appointment-registry";
import { allTimeZones, COMMON_TIME_ZONES, zonedParts } from "@/modules/crm/core/crm-timezone";

type Mode = CalendarView | "list";
const TONE: Record<AppointmentStatus, CalendarTone> = { SCHEDULED: "indigo", CONFIRMED: "green", RESCHEDULED: "amber", COMPLETED: "neutral", CANCELLED: "neutral", NO_SHOW: "red" };

export function toCalendarEvent(a: AppointmentDto, canEdit: boolean, pending = false): CalendarEvent {
  const who = [a.relations.company?.label, a.relations.contact?.label].filter(Boolean).join(" · ") || a.relations.opportunity?.label || a.relations.lead?.label || null;
  return {
    id: a.id,
    start: a.startAt ?? a.createdAt,
    end: a.endAt,
    title: a.title,
    subtitle: who,
    badge: `${a.statusLabel} · ${a.assignedTo?.fullName ?? "Unassigned"}`,
    tone: TONE[a.status] ?? "neutral",
    draggable: canEdit && a.allowed.actions.includes("reschedule"),
    muted: a.status === "CANCELLED" || a.status === "NO_SHOW",
    pending,
  };
}

/**
 * CRM calendar (Phase 10): Day / Week / Month views over the same
 * appointments (only the visible window is loaded), a List view with search,
 * filters, sort and paging, an employee filter (My calendar; the team's
 * calendars need crm.view_all) and a time zone for display. Dragging an
 * appointment calls the same reschedule API as the Reschedule dialog — moved
 * at once, put back if the server refuses; a busy employee needs confirmation.
 */
export function CalendarClient({ currentUserId, permissions }: { currentUserId: string; permissions: { create: boolean; edit: boolean; viewAll: boolean } }) {
  const params = useSearchParams();
  const { meta, users, error: lookupError, reload: reloadLookups } = useAppointmentLookups();
  const preferences = useCrmPreferences("calendar.");
  const { prefs, setPreference, loaded } = preferences;
  const [chosen, setChosen] = useState<{ mode?: Mode; tz?: string; employee?: string; date?: string }>({});
  const timeZone = chosen.tz ?? prefs["calendar.timezone"] ?? meta?.defaultTimeZone ?? "Asia/Kolkata";
  const mode: Mode = chosen.mode ?? (params.get("view") as Mode | null) ?? prefs["calendar.view"] ?? "week";
  const employee = chosen.employee ?? prefs["calendar.employee"] ?? "mine";
  const [today] = useState(() => new Date());
  const date = chosen.date ?? params.get("date") ?? zonedParts(today, timeZone).date;
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [record, setRecord] = useState<{ key: "contactId" | "companyId" | "opportunityId"; picked: CrmPickedRecord } | null>(() => {
    for (const key of ["opportunityId", "contactId", "companyId"] as const) {
      const id = params.get(key);
      if (id) return { key, picked: { id, label: "Selected record" } };
    }
    return null;
  });
  const [recordKind, setRecordKind] = useState<"contactId" | "companyId" | "opportunityId">("contactId");

  const set = (patch: Partial<typeof chosen>) => {
    setChosen((c) => ({ ...c, ...patch }));
    if (patch.mode) setPreference("calendar.view", patch.mode);
    if (patch.tz) setPreference("calendar.timezone", patch.tz);
    if (patch.employee) setPreference("calendar.employee", patch.employee as "mine");
  };

  // ── Data for the visible window ──
  const filterParams = useMemo(() => {
    const qs = new URLSearchParams();
    if (employee === "mine") qs.set("mine", "true");
    else if (employee !== "all") qs.set("assignedToUserIds", employee);
    if (status) qs.set("statuses", status);
    if (type) qs.set("appointmentTypes", type);
    if (record) qs.set(record.key, record.picked.id);
    return qs;
  }, [employee, status, type, record]);
  const range = useMemo(() => (mode === "list" ? null : calendarRange(mode, date, timeZone)), [mode, date, timeZone]);
  const query = range && loaded ? `${APPOINTMENTS_API}/calendar?${new URLSearchParams({ ...Object.fromEntries(filterParams), from: range.from.toISOString(), to: range.to.toISOString(), ...(search ? { search } : {}) })}` : null;
  const [state, setState] = useState<{ query: string; rows: AppointmentDto[]; truncated: boolean; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    fetch(query)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) setState((s) => ({ query, rows: s?.query === query ? s.rows : [], truncated: false, error: body?.error?.message ?? body?.message ?? "Couldn't load the calendar." }));
        else setState({ query, rows: body.data ?? [], truncated: Boolean(body.truncated), error: null });
      })
      .catch(() => !cancelled && setState({ query, rows: [], truncated: false, error: "Couldn't reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [query, tick]);
  const refresh = () => setTick((t) => t + 1);
  const loading = Boolean(query) && state?.query !== query;
  const rows = state?.rows ?? [];

  // ── Drag to reschedule (optimistic, with rollback) ──
  const [moves, setMoves] = useState<Record<string, { start: string; end: string }>>({});
  const [conflictMove, setConflictMove] = useState<{ a: AppointmentDto; start: Date; end: Date; conflicts: ConflictDto[] } | null>(null);
  const events = rows.map((a) => {
    const moved = moves[a.id];
    return toCalendarEvent(moved ? { ...a, startAt: moved.start, endAt: moved.end } : a, permissions.edit, Boolean(moved));
  });
  const settle = (id: string) =>
    setMoves((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
  const sendMove = async (a: AppointmentDto, start: Date, end: Date, allowConflict: boolean) => {
    const s = zonedParts(start, a.timezone);
    const e = zonedParts(end, a.timezone);
    const res = await crmRequest<AppointmentDto>(`${APPOINTMENTS_API}/${a.id}/reschedule`, {
      method: "POST",
      body: { version: a.version, startDate: s.date, startTime: s.time, endDate: e.date !== s.date ? e.date : "", endTime: e.time, ...(allowConflict ? { allowConflict: true } : {}) },
      toast: "off",
    });
    if (res.ok) {
      toast.success(`Rescheduled "${a.title}".`);
      setState((st) => (st ? { ...st, rows: st.rows.map((r) => (r.id === a.id ? res.data : r)) } : st));
      settle(a.id);
      refresh();
      return;
    }
    if (res.error.code === "CRM_APPOINTMENT_CONFLICT" && !allowConflict) {
      setConflictMove({ a, start, end, conflicts: (res.error.details?.conflicts as ConflictDto[]) ?? [] });
      return;
    }
    settle(a.id); // put it back
    toast.error(res.error.code === "RECORD_VERSION_CONFLICT" ? "This appointment was updated by someone else. The calendar has been refreshed." : res.error.message);
    if (res.error.code === "RECORD_VERSION_CONFLICT") refresh();
  };
  const onMove = (id: string, start: Date, end: Date) => {
    const a = rows.find((r) => r.id === id);
    if (!a || moves[id]) return;
    setMoves((m) => ({ ...m, [id]: { start: start.toISOString(), end: end.toISOString() } }));
    void sendMove(a, start, end, false).catch(() => {
      settle(id);
      toast.error("Couldn't reach the server. The appointment was not moved.");
    });
  };

  // ── Dialogs ──
  const [opened, setOpened] = useState<string | null>(null);
  const [creating, setCreating] = useState<AppointmentPrefill | null>(null);

  // ── List view ──
  const listFilters: CrmFilterDefinition[] = useMemo(
    () => [
      { type: "select", key: "statuses", label: "Status", options: Object.entries(APPOINTMENT_STATUSES).map(([k, s]) => ({ value: k, label: s.label })) },
      { type: "select", key: "when", label: "When", options: [{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }] },
      { type: "select", key: "appointmentTypes", label: "Type", options: (meta?.appointmentTypes ?? []).map((t) => ({ value: t, label: t })) },
      ...(permissions.viewAll ? [{ type: "select" as const, key: "assignedToUserIds", label: "Employee", options: users.map((u) => ({ value: u.id, label: u.fullName })) }] : []),
      { type: "select", key: "mine", label: "Assigned", options: [{ value: "true", label: "To me" }] },
    ],
    [meta, users, permissions.viewAll]
  );
  const listState = useCrmListState(["statuses", "when", "appointmentTypes", "assignedToUserIds", "mine"], { syncWithUrl: false });
  const columns: DataTableColumn<AppointmentDto>[] = [
    { key: "startAt", header: "When", sortable: true, render: (a) => <span className="whitespace-nowrap">{appointmentWhen(a, timeZone)}</span> },
    {
      key: "title",
      header: "Appointment",
      sortable: true,
      render: (a) => (
        <button type="button" onClick={() => setOpened(a.id)} className="text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {a.title}
        </button>
      ),
    },
    { key: "status", header: "Status", render: (a) => <AppointmentStatusBadge status={a.status} /> },
    { key: "employee", header: "Employee", render: (a) => a.assignedTo?.fullName ?? "—" },
    { key: "contact", header: "Contact", render: (a) => a.relations.contact?.label ?? "—" },
    { key: "company", header: "Company", render: (a) => a.relations.company?.label ?? "—" },
    { key: "opportunity", header: "Opportunity", render: (a) => a.relations.opportunity?.label ?? "—" },
    { key: "location", header: "Location", render: (a) => a.location ?? (a.videoLink ? "Video" : "—") },
  ];

  const zones = useMemo(() => {
    const first = [...new Set([timeZone, ...COMMON_TIME_ZONES])];
    return [...first, ...allTimeZones().filter((z) => !first.includes(z))].map((z) => ({ id: z, label: z.replace(/_/g, " ") }));
  }, [timeZone]);
  const employeeOptions = [{ id: "mine", label: "My calendar" }, { id: "all", label: permissions.viewAll ? "Everyone" : "All I can see" }, ...(permissions.viewAll ? users.map((u) => ({ id: u.id, label: u.fullName })) : [])];

  if (lookupError)
    return (
      <div role="alert" className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {lookupError}
        <Button size="xs" variant="secondary" onClick={reloadLookups}>
          Try again
        </Button>
      </div>
    );
  if (!meta || !loaded) return <div className="rounded-lg border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">Loading calendar…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
          {(["day", "week", "month", "list"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => set({ mode: m })} className={`rounded px-3 py-1 text-sm font-medium capitalize ${mode === m ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
              {m}
            </button>
          ))}
        </div>
        {mode !== "list" && (
          <>
            <div className="inline-flex items-center gap-1">
              <Button size="sm" variant="secondary" onClick={() => set({ date: shiftDate(mode, date, -1) })} aria-label="Previous">
                ‹
              </Button>
              <Button size="sm" variant="secondary" onClick={() => set({ date: zonedParts(new Date(), timeZone).date })}>
                Today
              </Button>
              <Button size="sm" variant="secondary" onClick={() => set({ date: shiftDate(mode, date, 1) })} aria-label="Next">
                ›
              </Button>
            </div>
            <input type="date" aria-label="Go to date" value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100" aria-live="polite">
              {periodLabel(mode, date)}
            </h2>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {permissions.create && (
            <Button size="sm" onClick={() => setCreating({ startDate: date })}>
              New appointment
            </Button>
          )}
        </div>
      </div>

      {mode !== "list" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="text-xs font-medium text-zinc-500" htmlFor="cal-employee">
              Employee
            </label>
            <SearchableSelect id="cal-employee" required value={employee} onChange={(v) => v && set({ employee: v })} options={employeeOptions} />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500" htmlFor="cal-status">
              Status
            </label>
            <select id="cal-status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <option value="">Any status</option>
              {Object.entries(APPOINTMENT_STATUSES).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500" htmlFor="cal-type">
              Type
            </label>
            <select id="cal-type" value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <option value="">Any type</option>
              {meta.appointmentTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-1">
            <label className="text-xs font-medium text-zinc-500" htmlFor="cal-record">
              <select aria-label="Filter by record type" value={record?.key ?? recordKind} onChange={(e) => (setRecordKind(e.target.value as typeof recordKind), setRecord(null))} className="border-none bg-transparent p-0 text-xs font-medium text-zinc-500 focus:ring-0">
                <option value="contactId">Contact</option>
                <option value="companyId">Company</option>
                <option value="opportunityId">Opportunity</option>
              </select>
            </label>
            <CrmRecordPicker<{ id: string; name?: string; fullName?: string; opportunityNumber?: string }>
              id="cal-record"
              lookupUrl={(record?.key ?? recordKind) === "contactId" ? "/api/v1/crm/contacts/lookup" : (record?.key ?? recordKind) === "companyId" ? "/api/v1/crm/companies/lookup" : "/api/v1/crm/opportunities?pageSize=15"}
              value={record?.picked ?? null}
              toOption={(r) => ({ id: r.id, label: r.fullName ?? r.name ?? "Record", sublabel: r.opportunityNumber ?? null })}
              onChange={(r) => setRecord(r ? { key: record?.key ?? recordKind, picked: r } : null)}
              placeholder="Any"
            />
          </div>
          <form
            role="search"
            className="lg:col-span-1"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchDraft.trim());
            }}
          >
            <label className="text-xs font-medium text-zinc-500" htmlFor="cal-search">
              Search
            </label>
            <input id="cal-search" type="search" value={searchDraft} onChange={(e) => (setSearchDraft(e.target.value), !e.target.value && setSearch(""))} placeholder="Title, contact, company, employee, location…" className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
          </form>
          <div>
            <label className="text-xs font-medium text-zinc-500" htmlFor="cal-tz">
              Time zone
            </label>
            <SearchableSelect id="cal-tz" required value={timeZone} onChange={(z) => z && set({ tz: z })} options={zones} />
          </div>
        </div>
      )}

      {mode === "list" ? (
        <CrmTable<AppointmentDto>
          fetchUrl={APPOINTMENTS_API}
          columns={columns}
          filters={listFilters}
          listState={listState}
          syncWithUrl={false}
          searchPlaceholder="Search title, contact, company, opportunity, employee, location…"
          onRowClick={(a) => setOpened(a.id)}
          refreshKey={tick}
          initialSort={{ sortBy: "startAt", sortOrder: "desc" }}
        />
      ) : (
        <>
          {state?.error && state.query === query && (
            <div role="alert" className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {state.error}
              <Button size="xs" variant="secondary" onClick={refresh}>
                Try again
              </Button>
            </div>
          )}
          {state?.truncated && <p className="text-sm text-amber-700">Showing the first 1,000 appointments in this period — narrow the filters to see the rest.</p>}
          <div className={loading ? "opacity-70" : undefined} aria-busy={loading}>
            <CrmCalendar
              view={mode}
              date={date}
              timeZone={timeZone}
              events={events}
              onEventClick={setOpened}
              onSlotClick={permissions.create ? (d, time) => setCreating({ startDate: d, startTime: time ?? "10:00" }) : undefined}
              onMove={permissions.edit ? onMove : undefined}
              onShowDay={(d) => set({ mode: "day", date: d })}
            />
          </div>
          {!loading && rows.length === 0 && !state?.error && <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">No appointments in this period{employee === "mine" ? " for you" : ""}.</p>}
        </>
      )}

      {conflictMove && (
        <Modal open onClose={() => (settle(conflictMove.a.id), setConflictMove(null))} title="Employee is busy">
          <div className="mt-3 space-y-3 text-sm">
            <p>
              Move <span className="font-medium">{conflictMove.a.title}</span> to {appointmentWhen({ startAt: conflictMove.start.toISOString(), endAt: conflictMove.end.toISOString() }, timeZone)}?
            </p>
            <ConflictNotice conflicts={conflictMove.conflicts} timeZone={timeZone} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  settle(conflictMove.a.id);
                  setConflictMove(null);
                }}
              >
                Keep current time
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const m = conflictMove;
                  setConflictMove(null);
                  void sendMove(m.a, m.start, m.end, true);
                }}
              >
                Move anyway
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {creating && (
        <AppointmentForm
          meta={meta}
          users={users}
          currentUserId={currentUserId}
          prefill={{ ...creating, assignedToUserId: employee !== "mine" && employee !== "all" ? employee : undefined }}
          defaultTimeZone={timeZone}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            refresh();
          }}
        />
      )}
      {opened && <AppointmentDetailModal appointmentId={opened} meta={meta} users={users} currentUserId={currentUserId} canEdit={permissions.edit} viewTimeZone={timeZone} onClose={() => setOpened(null)} onChanged={refresh} />}
    </div>
  );
}

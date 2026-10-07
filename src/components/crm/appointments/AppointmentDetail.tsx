"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { APPOINTMENT_STATUSES, type AppointmentAction } from "@/modules/crm/appointments/appointment-registry";
import { formatZonedDate, formatZonedTime, zoneAbbreviation } from "@/modules/crm/core/crm-timezone";
import { reminderLabel } from "@/modules/crm/activities/activity-registry";
import type { UserOptionDto } from "../activities/activity-types";
import { AppointmentForm, ConflictNotice } from "./AppointmentForm";
import { APPOINTMENTS_API, type AppointmentDto, type AppointmentMetaDto, type ConflictDto } from "./appointment-types";

export function AppointmentStatusBadge({ status }: { status: string }) {
  const s = APPOINTMENT_STATUSES[status as keyof typeof APPOINTMENT_STATUSES];
  return <CrmBadge label={s?.label ?? status} tone={(s?.tone ?? "neutral") as CrmBadgeTone} />;
}

/** "Wed, 15 Oct 2026 · 11:00 am – 12:00 pm IST" in the given zone. */
export function appointmentWhen(a: Pick<AppointmentDto, "startAt" | "endAt">, timeZone: string) {
  if (!a.startAt) return "No time set";
  return `${formatZonedDate(a.startAt, timeZone)} · ${formatZonedTime(a.startAt, timeZone)}${a.endAt ? ` – ${formatZonedTime(a.endAt, timeZone)}` : ""} ${zoneAbbreviation(a.startAt, timeZone)}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="col-span-2 break-words text-zinc-800 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

type ActionDialog = { kind: "reschedule" | "cancel" | "complete" | "no_show" } | { kind: "edit" } | null;

/**
 * Appointment detail: every field, the actions valid for its status (from the
 * server — never decided here), edit, and its own history. Times show in the
 * appointment's zone, and in the viewer's zone when that differs.
 */
export function AppointmentDetail({
  appointmentId,
  meta,
  users,
  currentUserId,
  canEdit,
  viewTimeZone,
  onChanged,
}: {
  appointmentId: string;
  meta: AppointmentMetaDto;
  users: UserOptionDto[];
  currentUserId: string;
  canEdit: boolean;
  viewTimeZone?: string;
  onChanged?: (a: AppointmentDto) => void;
}) {
  const [a, setA] = useState<AppointmentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    crmRequest<AppointmentDto>(`${APPOINTMENTS_API}/${appointmentId}`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setA(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, tick]);

  const changed = (next: AppointmentDto) => {
    setA(next);
    setDialog(null);
    setTick((t) => t + 1);
    onChanged?.(next);
  };
  const confirm = async () => {
    if (!a) return;
    setBusy(true);
    const res = await crmRequest<AppointmentDto>(`${APPOINTMENTS_API}/${a.id}/confirm`, { method: "POST", body: { version: a.version }, successMessage: "Appointment confirmed." });
    setBusy(false);
    if (res.ok) changed(res.data);
  };

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!a) return <p className="text-sm text-zinc-500">Loading…</p>;
  const tz = a.timezone;
  const viewer = viewTimeZone && viewTimeZone !== tz ? viewTimeZone : null;
  const has = (k: AppointmentAction) => canEdit && a.allowed.actions.includes(k);
  const recordLink = (l: AppointmentDto["relations"]["contact"]) => (l ? l.href ? <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={l.href}>{l.label}</Link> : l.label : "—");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{a.title}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{appointmentWhen(a, tz)}</p>
          {viewer && <p className="text-xs text-zinc-500">Your time: {appointmentWhen(a, viewer)}</p>}
        </div>
        <AppointmentStatusBadge status={a.status} />
      </div>

      {canEdit && (a.allowed.actions.length > 0 || a.allowed.edit) && (
        <div className="flex flex-wrap gap-2" aria-label="Appointment actions">
          {has("confirm") && (
            <Button size="sm" onClick={confirm} isLoading={busy}>
              Confirm appointment
            </Button>
          )}
          {has("reschedule") && (
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "reschedule" })}>
              Reschedule
            </Button>
          )}
          {has("complete") && (
            <Button size="sm" variant="success" onClick={() => setDialog({ kind: "complete" })}>
              Complete
            </Button>
          )}
          {has("no_show") && (
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "no_show" })}>
              Mark as no-show
            </Button>
          )}
          {a.allowed.edit && (
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "edit" })}>
              Edit
            </Button>
          )}
          {has("cancel") && (
            <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "cancel" })}>
              Cancel appointment
            </Button>
          )}
        </div>
      )}

      <dl className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {a.appointmentType && <Row label="Type">{a.appointmentType}</Row>}
        <Row label="Employee">{a.assignedTo?.fullName ?? "Unassigned"}</Row>
        <Row label="Contact">{recordLink(a.relations.contact)}</Row>
        <Row label="Company">{recordLink(a.relations.company)}</Row>
        <Row label="Opportunity">{recordLink(a.relations.opportunity)}</Row>
        {a.relations.lead && <Row label="Lead">{recordLink(a.relations.lead)}</Row>}
        <Row label="Start">{a.startAt ? `${formatZonedDate(a.startAt, tz)}, ${formatZonedTime(a.startAt, tz)}` : "—"}</Row>
        <Row label="End">{a.endAt ? `${formatZonedDate(a.endAt, tz)}, ${formatZonedTime(a.endAt, tz)}` : "—"}</Row>
        <Row label="Time zone">
          {tz}
          {a.startAt ? ` (${zoneAbbreviation(a.startAt, tz)})` : ""}
        </Row>
        <Row label="Location">{a.location ?? "—"}</Row>
        <Row label="Video meeting">
          {a.videoLink ? (
            <a href={a.videoLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
              Join meeting
            </a>
          ) : (
            "—"
          )}
        </Row>
        <Row label="Reminder">
          {reminderLabel(a.reminderOffsetMinutes)}
          {a.reminderState === "SENT" ? " · sent" : a.reminderState === "CANCELLED" ? " · cancelled" : ""}
        </Row>
        {a.rescheduleCount > 0 && <Row label="Rescheduled">{a.rescheduleCount}×{a.originalDueAt ? ` (first booked for ${formatZonedDate(a.originalDueAt, tz)}, ${formatZonedTime(a.originalDueAt, tz)})` : ""}</Row>}
        {a.confirmedAt && <Row label="Confirmed">{`${formatZonedDate(a.confirmedAt, tz)}${a.confirmedByName ? ` by ${a.confirmedByName}` : ""}`}</Row>}
        {a.cancelledAt && <Row label="Cancelled">{`${formatZonedDate(a.cancelledAt, tz)}${a.cancelledByName ? ` by ${a.cancelledByName}` : ""}${a.cancelReason ? ` · ${a.cancelReason}` : ""}`}</Row>}
        {a.noShowAt && <Row label="No-show">{`${formatZonedDate(a.noShowAt, tz)}${a.noShowByName ? ` by ${a.noShowByName}` : ""}${a.noShowReason ? ` · ${a.noShowReason}` : ""}`}</Row>}
        {a.completedAt && <Row label="Completed">{`${formatZonedDate(a.completedAt, tz)}${a.completedByName ? ` by ${a.completedByName}` : ""}${a.outcome ? ` · ${a.outcome}` : ""}`}</Row>}
        {typeof a.metadata?.completionNote === "string" && <Row label="Notes / next step">{a.metadata.completionNote}</Row>}
        {a.description && <Row label="Description">{a.description}</Row>}
        <Row label="Created">{`${formatZonedDate(a.createdAt, tz)} by ${a.createdBy.fullName}`}</Row>
        <Row label="Updated">{`${formatZonedDate(a.updatedAt, tz)}${a.updatedByName ? ` by ${a.updatedByName}` : ""}`}</Row>
      </dl>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">History</h4>
        <CrmTimeline entityType="ACTIVITY" entityId={a.id} pageSize={10} refreshKey={tick} emptyDescription="Changes to this appointment will appear here." />
      </div>

      {dialog?.kind === "edit" && <AppointmentForm meta={meta} users={users} currentUserId={currentUserId} appointment={a} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog?.kind === "reschedule" && <RescheduleDialog appointment={a} onClose={() => setDialog(null)} onDone={changed} />}
      {(dialog?.kind === "cancel" || dialog?.kind === "no_show" || dialog?.kind === "complete") && <OutcomeDialog kind={dialog.kind} appointment={a} meta={meta} onClose={() => setDialog(null)} onDone={changed} />}
    </div>
  );
}

/** New date / time (and zone) with an availability check; a busy employee needs explicit confirmation. */
export function RescheduleDialog({ appointment, onClose, onDone }: { appointment: AppointmentDto; onClose: () => void; onDone: (a: AppointmentDto) => void }) {
  const [v, setV] = useState({ startDate: appointment.start?.date ?? "", startTime: appointment.start?.time ?? "", endDate: appointment.end?.date ?? "", endTime: appointment.end?.time ?? "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictDto[] | null>(null);
  const submit = async (allowConflict: boolean) => {
    setBusy(true);
    setError(null);
    const res = await crmRequest<AppointmentDto>(`${APPOINTMENTS_API}/${appointment.id}/reschedule`, {
      method: "POST",
      body: { version: appointment.version, startDate: v.startDate, startTime: v.startTime, endDate: v.endDate && v.endDate !== v.startDate ? v.endDate : "", endTime: v.endTime, reason: v.reason, ...(allowConflict ? { allowConflict: true } : {}) },
      successMessage: "Appointment rescheduled.",
      toast: "off",
    });
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === "CRM_APPOINTMENT_CONFLICT") return setConflicts((res.error.details?.conflicts as ConflictDto[]) ?? []);
      return setError(res.error.message);
    }
    toast.success("Appointment rescheduled.");
    onDone(res.data);
  };
  return (
    <Modal open onClose={onClose} title="Reschedule appointment">
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {appointment.title} · now {appointmentWhen(appointment, appointment.timezone)}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="New date" htmlFor="rs-date" required>
            <input id="rs-date" type="date" className={textInputClass()} value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value, endDate: e.target.value })} required />
          </FormField>
          <FormField label="New start time" htmlFor="rs-start" required>
            <input id="rs-start" type="time" step={300} className={textInputClass()} value={v.startTime} onChange={(e) => setV({ ...v, startTime: e.target.value })} required />
          </FormField>
          <FormField label="End date" htmlFor="rs-end-date">
            <input id="rs-end-date" type="date" className={textInputClass()} value={v.endDate} min={v.startDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
          </FormField>
          <FormField label="New end time" htmlFor="rs-end" required>
            <input id="rs-end" type="time" step={300} className={textInputClass()} value={v.endTime} onChange={(e) => setV({ ...v, endTime: e.target.value })} required />
          </FormField>
        </div>
        <p className="text-xs text-zinc-500">Times are in {appointment.timezone}. To change the zone, edit the appointment.</p>
        <FormField label="Reason" htmlFor="rs-reason">
          <input id="rs-reason" className={textInputClass()} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={300} />
        </FormField>
        {conflicts && <ConflictNotice conflicts={conflicts} timeZone={appointment.timezone} />}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep current time
          </Button>
          {conflicts ? (
            <Button variant="danger" onClick={() => submit(true)} isLoading={busy}>
              Reschedule anyway
            </Button>
          ) : (
            <Button type="submit" isLoading={busy}>
              Reschedule
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

const OUTCOME_COPY = {
  cancel: { title: "Cancel appointment?", confirm: "Cancel Appointment", keep: "Keep Appointment", path: "cancel", toast: "Appointment cancelled.", reasonLabel: "Reason" },
  no_show: { title: "Mark as no-show?", confirm: "Mark as No Show", keep: "Go back", path: "no-show", toast: "Marked as no-show.", reasonLabel: "Reason" },
  complete: { title: "Complete appointment", confirm: "Complete", keep: "Go back", path: "complete", toast: "Appointment completed.", reasonLabel: "Outcome" },
} as const;

/** Cancel / no-show (optional reason from the configured list) and complete (outcome + notes / next step). */
export function OutcomeDialog({ kind, appointment, meta, onClose, onDone }: { kind: keyof typeof OUTCOME_COPY; appointment: AppointmentDto; meta: AppointmentMetaDto; onClose: () => void; onDone: (a: AppointmentDto) => void }) {
  const copy = OUTCOME_COPY[kind];
  const options = kind === "cancel" ? meta.cancelReasons : kind === "no_show" ? meta.noShowReasons : meta.outcomes;
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = kind === "complete" ? { version: appointment.version, outcome: reason, note } : { version: appointment.version, reason };
    const res = await crmRequest<AppointmentDto>(`${APPOINTMENTS_API}/${appointment.id}/${copy.path}`, { method: "POST", body, toast: "off" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    toast.success(copy.toast);
    onDone(res.data);
  };
  return (
    <Modal open onClose={onClose} title={copy.title}>
      <div className="mt-3 space-y-3 text-sm">
        <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <p className="font-medium text-zinc-900 dark:text-zinc-50">{appointment.title}</p>
          <p className="text-zinc-600 dark:text-zinc-300">{appointmentWhen(appointment, appointment.timezone)}</p>
        </div>
        <FormField label={copy.reasonLabel} htmlFor="outcome-reason">
          <input id="outcome-reason" list="outcome-reason-options" className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={kind === "complete" ? 120 : 300} />
          <datalist id="outcome-reason-options">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </FormField>
        {kind === "complete" && (
          <FormField label="What happened / next step" htmlFor="outcome-note">
            <textarea id="outcome-note" rows={3} className={textInputClass()} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="e.g. Customer requested revised quotation. Send it tomorrow." />
          </FormField>
        )}
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {copy.keep}
          </Button>
          <Button variant={kind === "complete" ? "success" : "danger"} onClick={submit} isLoading={busy}>
            {copy.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The detail in a modal (calendar, lists, record pages). */
export function AppointmentDetailModal(props: Parameters<typeof AppointmentDetail>[0] & { onClose: () => void }) {
  const { onClose, ...rest } = props;
  return (
    <Modal open onClose={onClose} title="Appointment" maxWidthClass="max-w-2xl">
      <div className="mt-3">
        <AppointmentDetail {...rest} />
      </div>
    </Modal>
  );
}

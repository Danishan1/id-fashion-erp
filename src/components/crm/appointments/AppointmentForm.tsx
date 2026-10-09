"use client";

import { useEffect, useMemo, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { addDays, allTimeZones, COMMON_TIME_ZONES, formatZonedTime, zonedParts } from "@/modules/crm/core/crm-timezone";
import type { UserOptionDto } from "../activities/activity-types";
import { APPOINTMENTS_API, type AppointmentDto, type AppointmentMetaDto, type AppointmentPrefill, type ConflictDto } from "./appointment-types";

type Picked = CrmPickedRecord | null;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Default start: the next full hour today, in the zone. */
function defaultStart(timeZone: string, now = new Date()) {
  const p = zonedParts(new Date(now.getTime() + 60 * 60_000), timeZone);
  return { date: p.date, time: `${String(p.hour).padStart(2, "0")}:00` };
}

/** Wall-clock end from a start + duration (rolls over midnight). */
function endFrom(date: string, time: string, minutes: number) {
  const total = minutesOf(time) + minutes;
  return { date: addDays(date, Math.floor(total / (24 * 60))), time: hhmm(total % (24 * 60)) };
}

export function ConflictNotice({ conflicts, timeZone }: { conflicts: ConflictDto[]; timeZone: string }) {
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-medium">The selected employee already has an appointment during this time.</p>
      <ul className="mt-1 ml-4 list-disc">
        {conflicts.map((c, i) => (
          <li key={c.id ?? i}>
            {c.title}
            {c.startAt && ` · ${formatZonedTime(c.startAt, timeZone)}${c.endAt ? ` – ${formatZonedTime(c.endAt, timeZone)}` : ""}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Create or edit an appointment. Opened from a contact / company /
 * opportunity, that record is filled in; choosing an opportunity fills its
 * company and contact, choosing a contact fills its company. Times are
 * entered in the chosen time zone. The employee's availability is checked
 * as the time changes; if they are busy the server refuses and the user can
 * book anyway explicitly.
 */
export function AppointmentForm({
  meta,
  users,
  currentUserId,
  appointment,
  prefill,
  defaultTimeZone,
  onClose,
  onSaved,
}: {
  meta: AppointmentMetaDto;
  users: UserOptionDto[];
  currentUserId: string;
  /** Edit this appointment; omit to create. */
  appointment?: AppointmentDto | null;
  prefill?: AppointmentPrefill;
  defaultTimeZone?: string;
  onClose: () => void;
  onSaved: (a: AppointmentDto) => void;
}) {
  const editing = Boolean(appointment);
  const initialZone = appointment?.timezone ?? defaultTimeZone ?? meta.defaultTimeZone;
  const start0 = appointment?.start ? { date: appointment.start.date, time: appointment.start.time } : prefill?.startDate ? { date: prefill.startDate, time: prefill.startTime ?? "10:00" } : defaultStart(initialZone);
  const end0 = appointment?.end ? { date: appointment.end.date, time: appointment.end.time } : endFrom(start0.date, start0.time, meta.defaultDurationMinutes);
  const [v, setV] = useState({
    title: appointment?.title ?? "",
    appointmentType: appointment?.appointmentType ?? "",
    description: appointment?.description ?? "",
    assignedToUserId: appointment?.assignedToUserId ?? prefill?.assignedToUserId ?? currentUserId,
    startDate: start0.date,
    startTime: start0.time,
    endDate: end0.date,
    endTime: end0.time,
    timezone: initialZone,
    location: appointment?.location ?? "",
    videoLink: appointment?.videoLink ?? "",
    reminderMinutes: appointment ? (appointment.reminderOffsetMinutes === null ? "" : String(appointment.reminderOffsetMinutes)) : "30",
  });
  const set = (k: keyof typeof v, value: string) => setV((p) => ({ ...p, [k]: value }));
  const rel = appointment?.relations;
  const pick = (l: { entityId: string; label: string } | null | undefined): Picked => (l ? { id: l.entityId, label: l.label } : null);
  const [contact, setContact] = useState<Picked>(rel ? pick(rel.contact) : prefill?.contact ? { id: prefill.contact.id, label: prefill.contact.label } : null);
  const [company, setCompany] = useState<Picked>(rel ? pick(rel.company) : prefill?.company ? { id: prefill.company.id, label: prefill.company.label } : null);
  const [opportunity, setOpportunity] = useState<Picked>(rel ? pick(rel.opportunity) : prefill?.opportunity ? { id: prefill.opportunity.id, label: prefill.opportunity.label } : null);
  const lead = rel?.lead ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<ConflictDto[] | null>(null);
  const zones = useMemo(() => {
    const all = allTimeZones();
    const first = [...new Set([v.timezone, ...COMMON_TIME_ZONES])];
    return [...first, ...all.filter((z) => !first.includes(z))].map((z) => ({ id: z, label: z.replace(/_/g, " ") }));
  }, [v.timezone]);

  // An opportunity picked on create brings its company and contact (prefill only — the user can change them).
  const prefillOpportunity = prefill?.opportunity?.id;
  useEffect(() => {
    if (editing || !prefillOpportunity) return;
    let cancelled = false;
    crmRequest<{ crmCompany: { id: string; name: string } | null; crmContact: { id: string; fullName: string } | null }>(`/api/v1/crm/opportunities/${prefillOpportunity}`, { toast: "off" }).then((res) => {
      if (cancelled || !res.ok) return;
      if (res.data.crmCompany) setCompany((c) => c ?? { id: res.data.crmCompany!.id, label: res.data.crmCompany!.name });
      if (res.data.crmContact) setContact((c) => c ?? { id: res.data.crmContact!.id, label: res.data.crmContact!.fullName });
    });
    return () => {
      cancelled = true;
    };
  }, [editing, prefillOpportunity]);

  // Live availability (debounced).
  const [availability, setAvailability] = useState<{ key: string; conflicts: ConflictDto[] } | null>(null);
  const availKey = `${v.assignedToUserId}|${v.startDate}|${v.startTime}|${v.endDate}|${v.endTime}|${v.timezone}`;
  useEffect(() => {
    if (!v.assignedToUserId || !v.startDate || !v.startTime || !v.endTime) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ assignedToUserId: v.assignedToUserId, startDate: v.startDate, startTime: v.startTime, endDate: v.endDate || v.startDate, endTime: v.endTime, timezone: v.timezone });
      if (appointment) qs.set("excludeId", appointment.id);
      crmRequest<{ available: boolean; conflicts: ConflictDto[] }>(`${APPOINTMENTS_API}/availability?${qs}`, { toast: "off" }).then((res) => {
        if (!cancelled && res.ok) setAvailability({ key: availKey, conflicts: res.data.conflicts });
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [availKey, v.assignedToUserId, v.startDate, v.startTime, v.endDate, v.endTime, v.timezone, appointment]);
  const liveConflicts = availability?.key === availKey ? availability.conflicts : [];

  const changeStart = (k: "startDate" | "startTime", value: string) => {
    // Moving the start keeps the length.
    const length = (new Date(`${v.endDate}T${v.endTime}:00Z`).getTime() - new Date(`${v.startDate}T${v.startTime}:00Z`).getTime()) / 60_000;
    const next = { ...v, [k]: value };
    if (next.startDate && /^\d\d:\d\d$/.test(next.startTime) && length > 0) {
      const e = endFrom(next.startDate, next.startTime, length);
      next.endDate = e.date;
      next.endTime = e.time;
    }
    setV(next);
    setConflicts(null);
  };

  const submit = async (allowConflict = false) => {
    if (!v.title.trim()) return setFieldErrors({ title: "Title is required." });
    if (!contact && !company && !opportunity && !lead) return setError("Choose the contact, company or opportunity this appointment is with.");
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body: Record<string, unknown> = {
      title: v.title.trim(),
      appointmentType: v.appointmentType,
      description: v.description,
      assignedToUserId: v.assignedToUserId,
      startDate: v.startDate,
      startTime: v.startTime,
      endDate: v.endDate && v.endDate !== v.startDate ? v.endDate : "",
      endTime: v.endTime,
      timezone: v.timezone,
      location: v.location,
      videoLink: v.videoLink.trim(),
      reminderMinutes: v.reminderMinutes,
      ...(lead ? { leadId: lead.entityId } : { contactId: contact?.id ?? "", companyId: company?.id ?? "", opportunityId: opportunity?.id ?? "" }),
      ...(allowConflict ? { allowConflict: true } : {}),
    };
    if (appointment) body.version = appointment.version;
    const res = appointment
      ? await crmRequest<AppointmentDto>(`${APPOINTMENTS_API}/${appointment.id}`, { method: "PATCH", body, successMessage: "Appointment updated.", toast: "off" })
      : await crmRequest<AppointmentDto>(APPOINTMENTS_API, { method: "POST", body, successMessage: "Appointment scheduled.", toast: "off" });
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === "CRM_APPOINTMENT_CONFLICT") return setConflicts((res.error.details?.conflicts as ConflictDto[]) ?? []);
      setFieldErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    onSaved(res.data);
  };

  const err = (k: string) => fieldErrors[k];
  return (
    <Modal open onClose={onClose} title={editing ? "Edit appointment" : "New appointment"} maxWidthClass="max-w-2xl">
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Title" htmlFor="appt-title" required error={err("title")}>
            <input id="appt-title" className={textInputClass(Boolean(err("title")))} value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="e.g. Product demo" autoFocus />
          </FormField>
          <FormField label="Type" htmlFor="appt-type">
            <input id="appt-type" list="appt-type-options" className={textInputClass()} value={v.appointmentType} onChange={(e) => set("appointmentType", e.target.value)} maxLength={80} />
            <datalist id="appt-type-options">
              {meta.appointmentTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </FormField>
        </div>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="sr-only">Related records</legend>
          {lead ? (
            <FormField label="Lead" htmlFor="appt-lead">
              <div id="appt-lead" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
                {lead.label}
              </div>
            </FormField>
          ) : (
            <>
              <FormField label="Opportunity" htmlFor="appt-opportunity" error={err("opportunityId")}>
                <CrmRecordPicker<{ id: string; name: string; opportunityNumber?: string; crmCompany?: { id: string; name: string } | null; crmContact?: { id: string; fullName: string } | null }>
                  id="appt-opportunity"
                  lookupUrl="/api/v1/crm/opportunities?pageSize=15"
                  value={opportunity}
                  toOption={(r) => ({ id: r.id, label: r.name, sublabel: r.opportunityNumber ?? null })}
                  onChange={(r) => {
                    setOpportunity(r);
                    if (r?.row?.crmCompany) setCompany({ id: r.row.crmCompany.id, label: r.row.crmCompany.name });
                    if (r?.row?.crmContact) setContact({ id: r.row.crmContact.id, label: r.row.crmContact.fullName });
                  }}
                  placeholder="Search opportunities…"
                  invalid={Boolean(err("opportunityId"))}
                />
              </FormField>
              <FormField label="Contact" htmlFor="appt-contact" error={err("contactId")}>
                <CrmRecordPicker<{ id: string; fullName: string; email?: string | null; crmCompany?: { id: string; name: string } | null }>
                  id="appt-contact"
                  lookupUrl="/api/v1/crm/contacts/lookup"
                  value={contact}
                  toOption={(r) => ({ id: r.id, label: r.fullName, sublabel: r.crmCompany?.name ?? r.email ?? null })}
                  onChange={(r) => {
                    setContact(r);
                    if (r?.row?.crmCompany && !company) setCompany({ id: r.row.crmCompany.id, label: r.row.crmCompany.name });
                  }}
                  placeholder="Search contacts…"
                  invalid={Boolean(err("contactId"))}
                />
              </FormField>
              <FormField label="Company" htmlFor="appt-company" error={err("companyId")}>
                <CrmRecordPicker<{ id: string; name: string; city?: string | null }>
                  id="appt-company"
                  lookupUrl="/api/v1/crm/companies/lookup"
                  value={company}
                  toOption={(r) => ({ id: r.id, label: r.name, sublabel: r.city ?? null })}
                  onChange={setCompany}
                  placeholder="Search companies…"
                  invalid={Boolean(err("companyId"))}
                />
              </FormField>
            </>
          )}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Assigned employee" htmlFor="appt-employee" required error={err("assignedToUserId")}>
            <SearchableSelect id="appt-employee" required value={v.assignedToUserId} onChange={(id) => set("assignedToUserId", id)} options={users.map((u) => ({ id: u.id, label: u.id === currentUserId ? `${u.fullName} (me)` : u.fullName }))} placeholder="Search employees…" />
          </FormField>
          <FormField label="Time zone" htmlFor="appt-timezone" required error={err("timezone")}>
            <SearchableSelect id="appt-timezone" required value={v.timezone} onChange={(z) => set("timezone", z || v.timezone)} options={zones} placeholder="Search time zones…" />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label="Start date" htmlFor="appt-start-date" required error={err("startDate")}>
            <input id="appt-start-date" type="date" className={textInputClass(Boolean(err("startDate")))} value={v.startDate} onChange={(e) => changeStart("startDate", e.target.value)} required />
          </FormField>
          <FormField label="Start time" htmlFor="appt-start-time" required error={err("startTime")}>
            <input id="appt-start-time" type="time" step={300} className={textInputClass(Boolean(err("startTime")))} value={v.startTime} onChange={(e) => changeStart("startTime", e.target.value)} required />
          </FormField>
          <FormField label="End date" htmlFor="appt-end-date" error={err("endDate")}>
            <input id="appt-end-date" type="date" className={textInputClass(Boolean(err("endDate")))} value={v.endDate} min={v.startDate} onChange={(e) => set("endDate", e.target.value)} />
          </FormField>
          <FormField label="End time" htmlFor="appt-end-time" required error={err("endTime")}>
            <input id="appt-end-time" type="time" step={300} className={textInputClass(Boolean(err("endTime")))} value={v.endTime} onChange={(e) => set("endTime", e.target.value)} required />
          </FormField>
        </div>
        {liveConflicts.length > 0 && !conflicts && <ConflictNotice conflicts={liveConflicts} timeZone={v.timezone} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Location" htmlFor="appt-location" error={err("location")}>
            <input id="appt-location" className={textInputClass()} value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={300} placeholder="e.g. ABC Textiles factory, Noida" />
          </FormField>
          <FormField label="Video meeting link" htmlFor="appt-video" error={err("videoLink")}>
            <input id="appt-video" type="url" className={textInputClass(Boolean(err("videoLink")))} value={v.videoLink} onChange={(e) => set("videoLink", e.target.value)} maxLength={500} placeholder="https://…" />
          </FormField>
          <FormField label="Reminder" htmlFor="appt-reminder" error={err("reminderMinutes")}>
            <select id="appt-reminder" className={textInputClass()} value={v.reminderMinutes} onChange={(e) => set("reminderMinutes", e.target.value)}>
              <option value="">No reminder</option>
              {meta.reminders
                .filter((r) => r.minutes > 0)
                .map((r) => (
                  <option key={r.minutes} value={String(r.minutes)}>
                    {r.label}
                  </option>
                ))}
            </select>
          </FormField>
        </div>
        <FormField label="Description" htmlFor="appt-description">
          <textarea id="appt-description" rows={3} className={textInputClass()} value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={5000} />
        </FormField>

        {conflicts && (
          <div className="space-y-2">
            <ConflictNotice conflicts={conflicts} timeZone={v.timezone} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConflicts(null)} disabled={busy}>
                Change the time
              </Button>
              <Button variant="danger" onClick={() => submit(true)} isLoading={busy}>
                Book anyway
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!conflicts && (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" isLoading={busy} loadingLabel="Saving…">
              {editing ? "Save changes" : "Schedule appointment"}
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
}

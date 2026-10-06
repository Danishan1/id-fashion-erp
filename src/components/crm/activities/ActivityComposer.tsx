"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ACTIVITIES_API, type ActivityDto, type ActivityMetaDto, type ActivityParentRef, type UserOptionDto } from "./activity-types";

const RECORD_TYPES = [
  { key: "OPPORTUNITY", label: "Opportunity", url: "/api/v1/crm/opportunities?pageSize=15", option: (r: { name: string; opportunityNumber?: string }) => ({ label: r.name, sublabel: r.opportunityNumber ?? null }) },
  { key: "CONTACT", label: "Contact", url: "/api/v1/crm/contacts/lookup", option: (r: { fullName?: string; name?: string; email?: string | null }) => ({ label: r.fullName ?? r.name ?? "Contact", sublabel: r.email ?? null }) },
  { key: "COMPANY", label: "Company", url: "/api/v1/crm/companies/lookup", option: (r: { name: string; city?: string | null }) => ({ label: r.name, sublabel: r.city ?? null }) },
  { key: "LEAD", label: "Lead", url: "/api/v1/crm/leads?pageSize=15", option: (r: { fullName: string; leadNumber?: string }) => ({ label: r.fullName, sublabel: r.leadNumber ?? null }) },
] as const;
type RecordType = (typeof RECORD_TYPES)[number]["key"];

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const nowTime = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);

/**
 * Add an activity: schedule a task / call / meeting / appointment (assignee,
 * due date and time, reminder, priority) or log something that already
 * happened (call, meeting, email, SMS, WhatsApp, other) with its outcome.
 * Opened from a record, the record is filled in and can't be changed; from
 * the activity list a record is picked.
 */
export function ActivityComposer({
  meta,
  users,
  currentUserId,
  parent,
  initialType = "TASK",
  initialMode,
  onClose,
  onSaved,
}: {
  meta: ActivityMetaDto;
  users: UserOptionDto[];
  currentUserId: string;
  parent?: ActivityParentRef | null;
  initialType?: string;
  initialMode?: "schedule" | "log";
  onClose: () => void;
  onSaved: (a: ActivityDto) => void;
}) {
  const [type, setType] = useState(initialType);
  const def = meta.types.find((t) => t.key === type) ?? meta.types[0];
  const [modeChoice, setMode] = useState<"schedule" | "log" | null>(initialMode ?? null);
  const mode: "schedule" | "log" = !def.schedulable ? "log" : !def.loggable ? "schedule" : (modeChoice ?? "schedule");
  const [v, setV] = useState({
    subject: "",
    description: "",
    priority: "NORMAL",
    assignedToUserId: currentUserId,
    dueDate: "",
    dueTime: "",
    endTime: "",
    reminderMinutes: "",
    occurredDate: today(),
    occurredTime: nowTime(),
    outcome: "",
    direction: "OUTBOUND",
    durationMinutes: "",
    location: "",
  });
  const set = (k: keyof typeof v, value: string) => setV((p) => ({ ...p, [k]: value }));
  const [recordType, setRecordType] = useState<RecordType>("OPPORTUNITY");
  const [record, setRecord] = useState<CrmPickedRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const outcomes = def.outcomeList ? (meta.outcomes[def.outcomeList] ?? []) : [];
  const err = (k: string) => fieldErrors[k];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entity = parent ? { entityType: parent.entityType, entityId: parent.entityId } : record ? { entityType: recordType, entityId: record.id } : null;
    if (!entity) return setError("Choose the record this activity is about.");
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { type, mode, subject: v.subject, description: v.description, priority: v.priority, ...entity };
    if (mode === "schedule") {
      Object.assign(body, { assignedToUserId: v.assignedToUserId || null, dueDate: v.dueDate, dueTime: v.dueTime, reminderMinutes: v.reminderMinutes, ...(def.hasEnd ? { endTime: v.endTime } : {}) });
    } else {
      Object.assign(body, { occurredDate: v.occurredDate, occurredTime: v.occurredTime, outcome: v.outcome, ...(def.hasDirection ? { direction: v.direction } : {}), ...(def.hasEnd ? { endTime: v.endTime } : {}), durationMinutes: v.durationMinutes });
    }
    if (type === "MEETING" || type === "APPOINTMENT") body.location = v.location;
    const res = await crmRequest<ActivityDto>(ACTIVITIES_API, { method: "POST", body, successMessage: mode === "log" ? `${def.label} logged.` : `${def.label} added.` });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    onSaved(res.data);
  };

  const rt = RECORD_TYPES.find((r) => r.key === recordType)!;
  return (
    <Modal open onClose={onClose} title={parent ? `New activity — ${parent.label}` : "New activity"} maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div role="radiogroup" aria-label="Activity type" className="flex flex-wrap gap-1.5">
          {meta.types.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={t.key === type}
              onClick={() => setType(t.key)}
              className={`rounded-full border px-3 py-1 text-sm ${t.key === type ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-300" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {def.schedulable && def.loggable && (
          <div role="radiogroup" aria-label="Schedule or log" className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="activity-mode" checked={mode === "schedule"} onChange={() => setMode("schedule")} />
              Schedule
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="activity-mode" checked={mode === "log"} onChange={() => setMode("log")} />
              Log (already happened)
            </label>
          </div>
        )}

        {!parent && (
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <FormField label="Related to" htmlFor="activity-record-type" required>
              <select
                id="activity-record-type"
                className={textInputClass()}
                value={recordType}
                onChange={(e) => {
                  setRecordType(e.target.value as RecordType);
                  setRecord(null);
                }}
              >
                {RECORD_TYPES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Record" htmlFor="activity-record" required error={err("entityId")}>
              <CrmRecordPicker<{ id: string } & Record<string, never>>
                key={recordType}
                id="activity-record"
                lookupUrl={rt.url}
                value={record}
                onChange={setRecord}
                toOption={(row) => ({ id: row.id, ...(rt.option as (r: unknown) => { label: string; sublabel: string | null })(row) })}
                placeholder={`Search ${rt.label.toLowerCase()}s…`}
                invalid={Boolean(err("entityId"))}
              />
            </FormField>
          </div>
        )}

        <FormField label="Subject" htmlFor="activity-subject" required error={err("subject")}>
          <input id="activity-subject" className={textInputClass(Boolean(err("subject")))} value={v.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} required autoFocus placeholder={mode === "log" ? `e.g. Called about the winter order` : `e.g. Follow up for quotation`} />
        </FormField>

        {mode === "schedule" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Due date" htmlFor="activity-due-date" error={err("dueDate")}>
                <input id="activity-due-date" type="date" className={textInputClass(Boolean(err("dueDate")))} value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
              </FormField>
              <FormField label={def.hasEnd ? "Start time" : "Due time"} htmlFor="activity-due-time" error={err("dueTime")}>
                <input id="activity-due-time" type="time" className={textInputClass()} value={v.dueTime} onChange={(e) => set("dueTime", e.target.value)} disabled={!v.dueDate} />
              </FormField>
              {def.hasEnd ? (
                <FormField label="End time" htmlFor="activity-end-time" error={err("endTime")}>
                  <input id="activity-end-time" type="time" className={textInputClass(Boolean(err("endTime")))} value={v.endTime} onChange={(e) => set("endTime", e.target.value)} disabled={!v.dueTime} />
                </FormField>
              ) : (
                <FormField label="Reminder" htmlFor="activity-reminder" error={err("reminderMinutes")}>
                  <select id="activity-reminder" className={textInputClass(Boolean(err("reminderMinutes")))} value={v.reminderMinutes} onChange={(e) => set("reminderMinutes", e.target.value)} disabled={!v.dueDate}>
                    <option value="">No reminder</option>
                    {meta.reminders.map((r) => (
                      <option key={r.minutes} value={r.minutes}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Assigned to" htmlFor="activity-assignee" error={err("assignedToUserId")}>
                <select id="activity-assignee" className={textInputClass(Boolean(err("assignedToUserId")))} value={v.assignedToUserId} onChange={(e) => set("assignedToUserId", e.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                      {u.id === currentUserId ? " (me)" : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Priority" htmlFor="activity-priority">
                <select id="activity-priority" className={textInputClass()} value={v.priority} onChange={(e) => set("priority", e.target.value)}>
                  {meta.priorities.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </FormField>
              {def.hasEnd && (
                <FormField label="Reminder" htmlFor="activity-reminder" error={err("reminderMinutes")}>
                  <select id="activity-reminder" className={textInputClass(Boolean(err("reminderMinutes")))} value={v.reminderMinutes} onChange={(e) => set("reminderMinutes", e.target.value)} disabled={!v.dueDate}>
                    <option value="">No reminder</option>
                    {meta.reminders.map((r) => (
                      <option key={r.minutes} value={r.minutes}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="When" htmlFor="activity-occurred-date" error={err("occurredDate")}>
                <input id="activity-occurred-date" type="date" className={textInputClass(Boolean(err("occurredDate")))} value={v.occurredDate} max={today()} onChange={(e) => set("occurredDate", e.target.value)} />
              </FormField>
              <FormField label="Time" htmlFor="activity-occurred-time">
                <input id="activity-occurred-time" type="time" className={textInputClass()} value={v.occurredTime} onChange={(e) => set("occurredTime", e.target.value)} />
              </FormField>
              {def.hasDirection ? (
                <FormField label="Direction" htmlFor="activity-direction">
                  <select id="activity-direction" className={textInputClass()} value={v.direction} onChange={(e) => set("direction", e.target.value)}>
                    <option value="OUTBOUND">Outgoing</option>
                    <option value="INBOUND">Incoming</option>
                  </select>
                </FormField>
              ) : (
                <FormField label="Duration (min)" htmlFor="activity-duration" error={err("durationMinutes")}>
                  <input id="activity-duration" type="number" min={0} max={1440} className={textInputClass()} value={v.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} />
                </FormField>
              )}
            </div>
            {(outcomes.length > 0 || type === "CALL" || type === "MEETING") && (
              <FormField label="Outcome" htmlFor="activity-outcome" error={err("outcome")}>
                <input id="activity-outcome" list="activity-outcome-options" className={textInputClass()} value={v.outcome} onChange={(e) => set("outcome", e.target.value)} maxLength={120} placeholder="e.g. Interested" />
                <datalist id="activity-outcome-options">
                  {outcomes.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </FormField>
            )}
          </>
        )}
        {(type === "MEETING" || type === "APPOINTMENT") && (
          <FormField label="Location" htmlFor="activity-location">
            <input id="activity-location" className={textInputClass()} value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={300} placeholder="Office, factory, video link…" />
          </FormField>
        )}
        <FormField label={mode === "log" ? "Notes" : "Description"} htmlFor="activity-description" error={err("description")}>
          <textarea id="activity-description" rows={3} maxLength={5000} className={textInputClass()} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…" disabled={!v.subject.trim()}>
            {mode === "log" ? `Log ${def.label.toLowerCase()}` : `Add ${def.label.toLowerCase()}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { AppointmentDetail } from "../appointments/AppointmentDetail";
import type { AppointmentDto } from "../appointments/appointment-types";
import { useAppointmentLookups } from "../appointments/useAppointmentLookups";
import Link from "next/link";
import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ACTIVITY_STATUSES, reminderLabel, type ActivityStatus } from "@/modules/crm/activities/activity-registry";
import { ActivityTypeIcon, DueStateBadge, DueText, PriorityBadge } from "./ActivityBadges";
import { ACTIVITIES_API, type ActivityDto, type ActivityMetaDto, type UserOptionDto } from "./activity-types";

type Panel = null | "complete" | "reschedule" | "assign" | "edit" | "cancel" | "delete";
const label = "text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400";

function Fact({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={label}>{name}</dt>
      <dd className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-100">{children ?? "—"}</dd>
    </div>
  );
}

/**
 * Everything about one activity, with its actions (complete, reopen,
 * reschedule, reassign, edit, cancel, delete) and its own history. Used in
 * the activity dialog and on /crm/activities/[id].
 */
export function ActivityDetail({
  activityId,
  meta,
  users,
  canEdit,
  onChanged,
  refreshKey = 0,
  currentUserId = "",
}: {
  activityId: string;
  meta: ActivityMetaDto | null;
  users: UserOptionDto[];
  canEdit: boolean;
  onChanged?: (a: ActivityDto | null) => void;
  refreshKey?: number;
  currentUserId?: string;
}) {
  const [a, setA] = useState<ActivityDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [history, setHistory] = useState(0);

  useEffect(() => {
    let cancelled = false;
    crmRequest<ActivityDto>(`${ACTIVITIES_API}/${activityId}`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setA(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [activityId, tick, refreshKey]);

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!a) return <CrmLoadingState />;
  // Appointments (Phase 10) have their own lifecycle and detail.
  if (a.type === "APPOINTMENT") return <AppointmentInActivity id={a.id} canEdit={canEdit} currentUserId={currentUserId} onChanged={(x) => onChanged?.(x as unknown as ActivityDto)} />;

  const open = (p: Panel) => {
    setFormError(null);
    setPanel(p);
    if (p === "complete") setForm({ outcome: a.outcome ?? "", note: "" });
    if (p === "reschedule") setForm({ dueDate: a.due?.date ?? "", dueTime: a.due?.time ?? "", reason: "" });
    if (p === "assign") setForm({ assignedToUserId: a.assignedToUserId ?? "" });
    if (p === "edit") setForm({ subject: a.subject, description: a.description ?? "", priority: a.priority, status: a.status, reminderMinutes: a.reminderOffsetMinutes === null ? "" : String(a.reminderOffsetMinutes) });
    if (p === "cancel") setForm({ reason: "" });
  };
  const run = async (path: string, body: Record<string, unknown>, successMessage: string, method = "POST") => {
    setBusy(true);
    setFormError(null);
    const res = await crmRequest<ActivityDto>(`${ACTIVITIES_API}/${a.id}${path}`, { method, body, successMessage, toast: "errors" });
    setBusy(false);
    if (!res.ok) return setFormError(res.error.message);
    setPanel(null);
    if (method === "DELETE") return onChanged?.(null);
    setA(res.data);
    setHistory((h) => h + 1);
    onChanged?.(res.data);
  };
  const def = meta?.types.find((t) => t.key === a.type);
  const outcomes = def?.outcomeList ? (meta?.outcomes[def.outcomeList] ?? []) : [];
  const isOpen = a.permissions.edit;
  const f = (k: string) => form[k] ?? "";
  const setF = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ActivityTypeIcon type={a.type} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {a.typeLabel} · {ACTIVITY_STATUSES[a.status as ActivityStatus]?.label ?? a.status}
          </p>
          <h3 className={`text-base font-semibold ${a.status === "CANCELLED" ? "line-through opacity-70" : ""}`}>{a.subject}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <DueStateBadge state={a.dueState} />
            <PriorityBadge priority={a.priority} />
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {a.permissions.complete && <Button onClick={() => open("complete")}>Mark complete</Button>}
          {a.permissions.reopen && (
            <Button variant="secondary" isLoading={busy} onClick={() => run("/reopen", { version: a.version }, "Activity reopened.")}>
              Reopen
            </Button>
          )}
          {isOpen && (
            <>
              <Button variant="secondary" onClick={() => open("reschedule")}>
                Reschedule
              </Button>
              <Button variant="secondary" onClick={() => open("assign")}>
                Reassign
              </Button>
              <Button variant="secondary" onClick={() => open("edit")}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => open("cancel")}>
                Cancel activity
              </Button>
            </>
          )}
          {a.permissions.delete && (
            <Button variant="danger" onClick={() => open("delete")}>
              Delete
            </Button>
          )}
        </div>
      )}

      {panel && (
        <form
          className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault();
            if (panel === "complete") run("/complete", { version: a.version, outcome: f("outcome"), note: f("note") }, "Marked complete.");
            if (panel === "reschedule") run("/reschedule", { version: a.version, dueDate: f("dueDate"), dueTime: f("dueTime"), reason: f("reason") }, "Rescheduled.");
            if (panel === "assign") run("/assign", { version: a.version, assignedToUserId: f("assignedToUserId") || null }, "Reassigned.");
            if (panel === "edit")
              run("", { version: a.version, subject: f("subject"), description: f("description"), priority: f("priority"), status: f("status"), ...(a.due ? { reminderMinutes: f("reminderMinutes") } : {}) }, "Activity updated.", "PATCH");
            if (panel === "cancel") run("/cancel", { version: a.version, reason: f("reason") }, "Activity cancelled.");
            if (panel === "delete") run("", {}, "Activity deleted.", "DELETE");
          }}
        >
          {panel === "complete" && (
            <>
              <FormField label="Outcome" htmlFor="complete-outcome">
                <input id="complete-outcome" list="complete-outcomes" className={textInputClass()} value={f("outcome")} onChange={(e) => setF("outcome", e.target.value)} maxLength={120} />
                <datalist id="complete-outcomes">
                  {outcomes.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </FormField>
              <FormField label="Completion note" htmlFor="complete-note">
                <textarea id="complete-note" rows={2} className={textInputClass()} value={f("note")} onChange={(e) => setF("note", e.target.value)} maxLength={2000} />
              </FormField>
            </>
          )}
          {panel === "reschedule" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="New date" htmlFor="resched-date" required>
                <input id="resched-date" type="date" className={textInputClass()} value={f("dueDate")} onChange={(e) => setF("dueDate", e.target.value)} required />
              </FormField>
              <FormField label="Time" htmlFor="resched-time">
                <input id="resched-time" type="time" className={textInputClass()} value={f("dueTime")} onChange={(e) => setF("dueTime", e.target.value)} />
              </FormField>
              <FormField label="Reason" htmlFor="resched-reason">
                <input id="resched-reason" className={textInputClass()} value={f("reason")} onChange={(e) => setF("reason", e.target.value)} maxLength={300} />
              </FormField>
            </div>
          )}
          {panel === "assign" && (
            <FormField label="Assign to" htmlFor="assign-user">
              <select id="assign-user" className={textInputClass()} value={f("assignedToUserId")} onChange={(e) => setF("assignedToUserId", e.target.value)}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {panel === "edit" && (
            <>
              <FormField label="Subject" htmlFor="edit-subject" required>
                <input id="edit-subject" className={textInputClass()} value={f("subject")} onChange={(e) => setF("subject", e.target.value)} maxLength={200} required />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Priority" htmlFor="edit-priority">
                  <select id="edit-priority" className={textInputClass()} value={f("priority")} onChange={(e) => setF("priority", e.target.value)}>
                    {(meta?.priorities ?? []).map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Status" htmlFor="edit-status">
                  <select id="edit-status" className={textInputClass()} value={f("status")} onChange={(e) => setF("status", e.target.value)}>
                    <option value="PENDING">Pending</option>
                    <option value="IN_PROGRESS">In progress</option>
                  </select>
                </FormField>
                {a.due && (
                  <FormField label="Reminder" htmlFor="edit-reminder">
                    <select id="edit-reminder" className={textInputClass()} value={f("reminderMinutes")} onChange={(e) => setF("reminderMinutes", e.target.value)}>
                      <option value="">No reminder</option>
                      {(meta?.reminders ?? []).map((r) => (
                        <option key={r.minutes} value={r.minutes}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                )}
              </div>
              <FormField label="Description" htmlFor="edit-description">
                <textarea id="edit-description" rows={3} className={textInputClass()} value={f("description")} onChange={(e) => setF("description", e.target.value)} maxLength={5000} />
              </FormField>
            </>
          )}
          {panel === "cancel" && (
            <FormField label="Reason" htmlFor="cancel-reason">
              <input id="cancel-reason" className={textInputClass()} value={f("reason")} onChange={(e) => setF("reason", e.target.value)} maxLength={300} />
            </FormField>
          )}
          {panel === "delete" && <p className="text-sm">Delete this {a.typeLabel.toLowerCase()}? It leaves the record; the audit log keeps it.</p>}
          {formError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPanel(null)} disabled={busy}>
              Back
            </Button>
            <Button type="submit" variant={panel === "delete" || panel === "cancel" ? "danger" : "primary"} isLoading={busy} loadingLabel="Saving…">
              {{ complete: "Complete", reschedule: "Reschedule", assign: "Save", edit: "Save", cancel: "Cancel activity", delete: "Delete" }[panel]}
            </Button>
          </div>
        </form>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact name={a.type === "TASK" ? "Due" : "When"}>
          <DueText activity={a} />
          {a.rescheduleCount > 0 && a.originalDueAt && <span className="block text-xs text-zinc-500">Rescheduled {a.rescheduleCount}× · first due <ClientDateTime value={a.originalDueAt} /></span>}
        </Fact>
        <Fact name="Assigned to">{a.assignedTo?.fullName ?? "Unassigned"}</Fact>
        <Fact name="Related to">
          <span className="flex flex-col">
            {a.links.map((l) =>
              l.href ? (
                <Link key={`${l.entityType}-${l.entityId}`} href={l.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {l.label}
                  <span className="text-xs text-zinc-500"> · {l.entityType.toLowerCase()}</span>
                </Link>
              ) : (
                <span key={`${l.entityType}-${l.entityId}`}>{l.label}</span>
              )
            )}
          </span>
        </Fact>
        <Fact name="Reminder">{a.reminderOffsetMinutes === null ? "No reminder" : `${reminderLabel(a.reminderOffsetMinutes)}${a.reminderState === "SENT" ? " · sent" : a.reminderState === "CANCELLED" ? " · not needed" : ""}`}</Fact>
        {a.outcome && <Fact name="Outcome">{a.outcome}</Fact>}
        {a.direction && <Fact name="Direction">{a.direction === "INBOUND" ? "Incoming" : "Outgoing"}</Fact>}
        {a.durationMinutes !== null && <Fact name="Duration">{a.durationMinutes} min</Fact>}
        {a.location && <Fact name="Location">{a.location}</Fact>}
        <Fact name="Created">
          {a.createdBy.fullName} · <ClientDateTime value={a.createdAt} />
        </Fact>
        {a.completedAt && (
          <Fact name="Completed">
            {a.completedByName ?? "—"} · <ClientDateTime value={a.completedAt} />
          </Fact>
        )}
      </dl>
      {a.description && <p className="whitespace-pre-line text-sm text-zinc-800 dark:text-zinc-100">{a.description}</p>}
      {typeof a.metadata?.completionNote === "string" && (
        <p className="text-sm">
          <span className={label}>Completion note: </span>
          {a.metadata.completionNote}
        </p>
      )}
      <div>
        <p className={`${label} mb-2`}>History</p>
        <CrmTimeline entityType="ACTIVITY" entityId={a.id} pageSize={10} refreshKey={history} emptyDescription="Changes to this activity will appear here." />
      </div>
    </div>
  );
}

/** The detail in a dialog (from lists and record panels). */
function AppointmentInActivity({ id, canEdit, currentUserId, onChanged }: { id: string; canEdit: boolean; currentUserId: string; onChanged: (a: AppointmentDto) => void }) {
  const { meta, users, error } = useAppointmentLookups();
  if (error) return <CrmErrorState message={error} />;
  if (!meta) return <CrmLoadingState />;
  return <AppointmentDetail appointmentId={id} meta={meta} users={users} currentUserId={currentUserId} canEdit={canEdit} onChanged={onChanged} />;
}

export function ActivityDetailModal(props: Parameters<typeof ActivityDetail>[0] & { onClose: () => void }) {
  const { onClose, onChanged, ...rest } = props;
  return (
    <Modal open onClose={onClose} title="Activity" maxWidthClass="max-w-2xl">
      <div className="mt-4">
        <ActivityDetail
          {...rest}
          onChanged={(a) => {
            onChanged?.(a);
            if (!a) onClose();
          }}
        />
      </div>
    </Modal>
  );
}

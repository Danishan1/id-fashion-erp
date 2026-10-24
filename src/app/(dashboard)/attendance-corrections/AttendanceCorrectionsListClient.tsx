"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { RowAction } from "@/components/ui/RowAction";
import { ApproveIcon, EyeIcon, RejectIcon } from "@/components/ui/icons";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "@/lib/hr-approval-status-labels";
import { apiJson, ErrorText, fmtDateTime, fmtDbDate, fmtTime, Tabs, todayIst } from "../attendance/_shared/attendance-ui";
import { useScopedEmployees } from "../attendance/_shared/useScopedEmployees";

const TYPES = [
  { value: "MISSED_PUNCH", label: "Missed Punch", help: "You worked but no punch was recorded — give login and logout time." },
  { value: "MISSED_LOGOUT", label: "Missed Logout", help: "You punched in but forgot to punch out." },
  { value: "CHANGE_LOGIN", label: "Change Login", help: "Your recorded login time is wrong." },
  { value: "CHANGE_LOGOUT", label: "Change Logout", help: "Your recorded logout time is wrong." },
  { value: "LEAVE_NOT_TAKEN", label: "Leave Not Taken", help: "Leave was approved but you came to work — the leave is cancelled and the quota given back." },
  { value: "EMERGENCY_LEAVE", label: "Emergency Leave", help: "You were absent without applying — leave is recorded for those past days (paid while balance lasts)." },
] as const;
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

interface CorrectionRow {
  id: string;
  type: string;
  attendanceDate: string;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  reason: string;
  status: keyof typeof STATUS_LABELS;
  rejectionReason: string | null;
  createdAt: string;
  employee: { fullName: string; employeeCode: string };
  createdBy: { fullName: string };
  approvedBy: { fullName: string } | null;
}

function details(row: CorrectionRow) {
  if (row.type === "LEAVE_NOT_TAKEN" || row.type === "EMERGENCY_LEAVE") return `${fmtDbDate(row.dateFrom)} – ${fmtDbDate(row.dateTo)}`;
  const parts = [fmtDbDate(row.attendanceDate)];
  if (row.requestedPunchIn) parts.push(`in ${fmtTime(row.requestedPunchIn)}`);
  if (row.requestedPunchOut) parts.push(`out ${fmtTime(row.requestedPunchOut)}`);
  return parts.join(" · ");
}

type TabId = "mine" | "team";

export function AttendanceCorrectionsListClient({ canApprove, canReject, canManageTeam }: { canApprove: boolean; canReject: boolean; canManageTeam: boolean }) {
  const [tab, setTab] = useState<TabId>("mine");
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<CorrectionRow | null>(null);
  const [approveTarget, setApproveTarget] = useState<CorrectionRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CorrectionRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => setRefreshKey((k) => k + 1);

  const approve = async () => {
    const r = approveTarget;
    setApproveTarget(null);
    if (!r) return;
    try {
      await apiJson(`/api/v1/attendance-corrections/${r.id}/approve`, { method: "POST" });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reject = async () => {
    if (!rejectTarget) return;
    try {
      await apiJson(`/api/v1/attendance-corrections/${rejectTarget.id}/reject`, { method: "POST", body: JSON.stringify({ reason: rejectReason }) });
      setRejectTarget(null);
      setRejectReason("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Regularization" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Regularization</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Fix a missed or wrong punch, cancel leave you didn&apos;t take, or record emergency leave. Changes apply only after approval.</p>
        </div>
        <Button onClick={() => setCreating(true)}>New Request</Button>
      </div>
      {canManageTeam && (
        <Tabs<TabId>
          tabs={[
            { id: "mine", label: "My requests" },
            { id: "team", label: "Team requests" },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      <ErrorText message={error} />
      <DataTable<CorrectionRow>
        key={`${tab}-${refreshKey}`}
        fetchUrl="/api/v1/attendance-corrections"
        extraParams={tab === "mine" ? { mine: "true" } : undefined}
        searchPlaceholder="Search by employee name…"
        columns={[
          { key: "employee", header: "Employee", render: (r) => `${r.employee.fullName} (${r.employee.employeeCode})` },
          { key: "type", header: "Type", render: (r) => TYPE_LABEL[r.type] ?? r.type },
          { key: "details", header: "Details", render: (r) => details(r) },
          { key: "reason", header: "Reason", render: (r) => (r.rejectionReason ? `${r.reason} · Rejected: ${r.rejectionReason}` : r.reason) },
          { key: "status", header: "Status", render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[r.status]}`}>{STATUS_LABELS[r.status] ?? r.status}</span> },
          {
            key: "actions",
            header: "Actions",
            render: (r) => (
              <div className="flex gap-3">
                <RowAction icon={<EyeIcon />} label="View" onClick={() => setViewing(r)} />
                {r.status === "PENDING" && tab === "team" && canApprove && <RowAction icon={<ApproveIcon />} label="Approve" variant="success" onClick={() => setApproveTarget(r)} />}
                {r.status === "PENDING" && tab === "team" && canReject && <RowAction icon={<RejectIcon />} label="Reject" variant="danger" onClick={() => setRejectTarget(r)} />}
              </div>
            ),
          },
        ]}
      />
      <Modal open={creating} onClose={() => setCreating(false)} title="New regularization request" maxWidthClass="max-w-lg">
        {creating && (
          <NewRequestForm
            canRaiseForOthers={canManageTeam}
            onClose={() => setCreating(false)}
            onDone={() => {
              setCreating(false);
              refresh();
            }}
          />
        )}
      </Modal>
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing ? `${TYPE_LABEL[viewing.type]} — ${viewing.employee.fullName}` : ""} maxWidthClass="max-w-lg">
        {viewing && <RequestDetail key={viewing.id} row={viewing} />}
      </Modal>
      <ConfirmModal
        open={approveTarget !== null}
        title="Approve this request?"
        message={approveTarget ? `${TYPE_LABEL[approveTarget.type]} for ${approveTarget.employee.fullName} (${details(approveTarget)}) will be applied now.` : ""}
        confirmLabel="Approve"
        onConfirm={approve}
        onCancel={() => setApproveTarget(null)}
      />
      <Modal open={rejectTarget !== null} onClose={() => setRejectTarget(null)} title="Reject request">
        <div className="space-y-3">
          <FormField label="Reason" htmlFor="corr-reject" required>
            <textarea id="corr-reject" rows={2} className={textInputClass()} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reject} disabled={!rejectReason.trim()}>
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface SessionOption {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  source: string;
}

function NewRequestForm({ canRaiseForOthers, onClose, onDone }: { canRaiseForOthers: boolean; onClose: () => void; onDone: () => void }) {
  const { options: employeeOptions } = useScopedEmployees();
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<string>("MISSED_PUNCH");
  const [date, setDate] = useState(todayIst());
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [dateFrom, setDateFrom] = useState(todayIst());
  const [dateTo, setDateTo] = useState(todayIst());
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsSession = type === "CHANGE_LOGIN" || type === "CHANGE_LOGOUT" || type === "MISSED_LOGOUT";
  const isRange = type === "LEAVE_NOT_TAKEN" || type === "EMERGENCY_LEAVE";

  useEffect(() => {
    fetch("/api/v1/leave-types")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setLeaveTypes((b.data ?? []).filter((t: { isActive: boolean }) => t.isActive)))
      .catch(() => setLeaveTypes([]));
  }, []);

  const loadSessions = useCallback(() => {
    const qs = new URLSearchParams({ date });
    if (employeeId) qs.set("employeeId", employeeId);
    const url = employeeId ? `/api/v1/attendance/sessions?${qs}` : `/api/v1/attendance/me/sessions?${qs}`;
    apiJson<SessionOption[]>(url)
      .then((s) => {
        setSessions(s);
        setSessionId(s[0]?.id ?? "");
      })
      .catch(() => setSessions([]));
  }, [date, employeeId]);
  useEffect(() => {
    if (needsSession) loadSessions();
  }, [needsSession, loadSessions]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await apiJson<{ id: string }>("/api/v1/attendance-corrections", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId || undefined,
          type,
          attendanceDate: type === "MISSED_PUNCH" ? date : undefined,
          sessionId: needsSession ? sessionId : undefined,
          checkIn: type === "MISSED_PUNCH" || type === "CHANGE_LOGIN" ? checkIn : undefined,
          checkOut: type !== "CHANGE_LOGIN" && !isRange ? checkOut : undefined,
          dateFrom: isRange ? dateFrom : undefined,
          dateTo: isRange ? dateTo : undefined,
          leaveTypeId: type === "EMERGENCY_LEAVE" ? leaveTypeId : undefined,
          reason,
        }),
      });
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await apiJson(`/api/v1/attendance-corrections/${created.id}/documents`, { method: "POST", body: form });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorText message={error} />
      {canRaiseForOthers && (
        <FormField label="Employee (leave empty for yourself)" htmlFor="corr-emp">
          <SearchableSelect id="corr-emp" options={employeeOptions} value={employeeId} onChange={setEmployeeId} placeholder="Myself" emptyOptionLabel="Myself" />
        </FormField>
      )}
      <FormField label="Type" htmlFor="corr-type" required>
        <select id="corr-type" className={textInputClass()} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </FormField>
      <p className="text-xs text-zinc-500">{TYPES.find((t) => t.value === type)?.help}</p>
      {!isRange && (
        <FormField label="Date" htmlFor="corr-date" required>
          <input id="corr-date" type="date" max={todayIst()} className={textInputClass()} value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      )}
      {needsSession && (
        <FormField label="Punch session" htmlFor="corr-session" required>
          {sessions.length === 0 ? (
            <p className="text-sm text-amber-700">No punch found on this date{type === "MISSED_LOGOUT" ? "" : " — use Missed Punch instead"}.</p>
          ) : (
            <select id="corr-session" className={textInputClass()} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {fmtTime(s.checkInAt)} – {s.checkOutAt ? fmtTime(s.checkOutAt) : "no logout"}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      {(type === "MISSED_PUNCH" || type === "CHANGE_LOGIN") && (
        <FormField label={type === "MISSED_PUNCH" ? "Login time" : "Correct login time"} htmlFor="corr-in" required>
          <input id="corr-in" type="time" className={textInputClass()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </FormField>
      )}
      {(type === "MISSED_PUNCH" || type === "CHANGE_LOGOUT" || type === "MISSED_LOGOUT") && (
        <FormField label={type === "CHANGE_LOGOUT" ? "Correct logout time" : "Logout time"} htmlFor="corr-out" required>
          <input id="corr-out" type="time" className={textInputClass()} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </FormField>
      )}
      {isRange && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="From" htmlFor="corr-from" required>
            <input id="corr-from" type="date" className={textInputClass()} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </FormField>
          <FormField label="To" htmlFor="corr-to" required>
            <input id="corr-to" type="date" min={dateFrom} className={textInputClass()} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </FormField>
        </div>
      )}
      {type === "EMERGENCY_LEAVE" && (
        <FormField label="Leave type" htmlFor="corr-lt" required>
          <select id="corr-lt" className={textInputClass()} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
            <option value="">Select…</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
      )}
      <FormField label="Reason" htmlFor="corr-reason" required>
        <textarea id="corr-reason" rows={2} className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <FormField label="Supporting document (optional — medical slip, visit pass…)" htmlFor="corr-file">
        <input id="corr-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} isLoading={saving} loadingLabel="Submitting…" disabled={!reason.trim()}>
          Submit
        </Button>
      </div>
    </div>
  );
}

interface DocRow {
  id: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: { fullName: string } | null;
}

function RequestDetail({ row }: { row: CorrectionRow }) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<DocRow[]>(`/api/v1/attendance-corrections/${row.id}/documents`)
      .then(setDocs)
      .catch((e) => setError(e.message));
  }, [row.id]);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async () => {
    if (!file) return;
    try {
      const form = new FormData();
      form.append("file", file);
      await apiJson(`/api/v1/attendance-corrections/${row.id}/documents`, { method: "POST", body: form });
      setFile(null);
      setInputKey((k) => k + 1);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <ErrorText message={error} />
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
        <dt className="text-zinc-500">Details</dt>
        <dd className="col-span-2">{details(row)}</dd>
        <dt className="text-zinc-500">Reason</dt>
        <dd className="col-span-2">{row.reason}</dd>
        <dt className="text-zinc-500">Raised by</dt>
        <dd className="col-span-2">
          {row.createdBy.fullName} · {fmtDateTime(row.createdAt)}
        </dd>
        <dt className="text-zinc-500">Status</dt>
        <dd className="col-span-2">
          {STATUS_LABELS[row.status]}
          {row.approvedBy && ` by ${row.approvedBy.fullName}`}
          {row.rejectionReason && ` — ${row.rejectionReason}`}
        </dd>
      </dl>
      <div>
        <div className="mb-1 font-medium">Documents</div>
        {docs.length === 0 ? (
          <p className="text-zinc-500">None.</p>
        ) : (
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.id}>
                <a className="text-indigo-600 hover:underline" href={`/api/v1/attendance-corrections/${row.id}/documents/${d.id}`} target="_blank" rel="noreferrer">
                  {d.fileName}
                </a>{" "}
                <span className="text-xs text-zinc-500">
                  {d.uploadedBy?.fullName} · {fmtDateTime(d.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-2">
          <input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button size="xs" variant="secondary" disabled={!file} onClick={upload}>
            Upload
          </Button>
        </div>
      </div>
    </div>
  );
}

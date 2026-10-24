"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDateTime, fmtDbDate, fmtTime, Tabs, todayIst } from "../_shared/attendance-ui";
import { fromIstLocalInput, toIstLocalInput } from "../_shared/CorrectSessionModal";
import { OutdoorStatusPill } from "../_shared/OutdoorStatusPill";
import type { OutdoorRejectionRow } from "../my/MyOutdoorRejections";

interface UnverifiedRow {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  isLoginFromOffice: boolean;
  isLogoutFromOffice: boolean;
  inDistanceMeters: number | null;
  outDistanceMeters: number | null;
  inLatitude: number | null;
  inLongitude: number | null;
  inLocation: { name: string } | null;
  outLocation: { name: string } | null;
  employee: { fullName: string; employeeCode: string };
  attendanceRecord: { attendanceDate: string };
}

type TabId = "review" | "rejections";

export function OutdoorPunchesClient({ canApprove, canReject }: { canApprove: boolean; canReject: boolean }) {
  const [tab, setTab] = useState<TabId>("review");
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance", href: "/attendance" }, { label: "Outdoor Punches" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Outdoor Punches</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Punches made outside every office location. Approve them as they are, or reject — rejecting cuts the times to what you allow, and the employee can accept or explain.
        </p>
      </div>
      <Tabs<TabId>
        tabs={[
          { id: "review", label: "Needs review" },
          { id: "rejections", label: "Rejections & clarifications" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "review" ? <ReviewTab canApprove={canApprove} canReject={canReject} /> : <RejectionsTab canApprove={canApprove} canReject={canReject} />}
    </div>
  );
}

function ReviewTab({ canApprove, canReject }: { canApprove: boolean; canReject: boolean }) {
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [rows, setRows] = useState<UnverifiedRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejecting, setRejecting] = useState<UnverifiedRow | null>(null);

  const load = useCallback(() => {
    apiJson<UnverifiedRow[]>(`/api/v1/attendance/outdoor?month=${month}`)
      .then((r) => {
        setRows(r);
        setSelected(new Set());
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  const approve = async () => {
    setConfirmApprove(false);
    try {
      await apiJson("/api/v1/attendance/outdoor", { method: "POST", body: JSON.stringify({ sessionIds: [...selected] }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Card
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          {canApprove && (
            <Button size="xs" variant="success" disabled={selected.size === 0} onClick={() => setConfirmApprove(true)}>
              Approve selected ({selected.size})
            </Button>
          )}
        </div>
      }
    >
      <ErrorText message={error} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr className="text-left text-xs font-medium uppercase text-zinc-500">
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-2 py-2">Employee</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">In</th>
              <th className="px-2 py-2">Out</th>
              <th className="px-2 py-2">Distance</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-zinc-500">
                  No outside punches waiting.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-2 py-2">
                  <input type="checkbox" aria-label="Select" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="px-2 py-2">
                  <div className="font-medium">{r.employee.fullName}</div>
                  <div className="text-xs text-zinc-500">{r.employee.employeeCode}</div>
                </td>
                <td className="px-2 py-2">{fmtDbDate(r.attendanceRecord.attendanceDate)}</td>
                <td className="px-2 py-2 tabular-nums">
                  {fmtTime(r.checkInAt)} <span className="text-xs text-zinc-500">{r.isLoginFromOffice ? "(office)" : "(outside)"}</span>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {r.checkOutAt ? (
                    <>
                      {fmtTime(r.checkOutAt)} <span className="text-xs text-zinc-500">{r.isLogoutFromOffice ? "(office)" : "(outside)"}</span>
                    </>
                  ) : (
                    <span className="text-emerald-700">running</span>
                  )}
                </td>
                <td className="px-2 py-2 text-xs">
                  {r.inDistanceMeters !== null && <div>In: {r.inDistanceMeters} m</div>}
                  {r.outDistanceMeters !== null && <div>Out: {r.outDistanceMeters} m</div>}
                  {r.inLatitude !== null && (
                    <a className="text-indigo-600 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.inLatitude},${r.inLongitude}`}>
                      Map
                    </a>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {canReject && (
                    <button type="button" className="text-sm font-medium text-red-600 hover:text-red-500 disabled:text-zinc-400" disabled={!r.checkOutAt} onClick={() => setRejecting(r)}>
                      Reject
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmModal
        open={confirmApprove}
        title={`Approve ${selected.size} outside punch(es)?`}
        message="They will count as normal attendance with their full times."
        confirmLabel="Approve"
        onConfirm={approve}
        onCancel={() => setConfirmApprove(false)}
      />
      <Modal open={rejecting !== null} onClose={() => setRejecting(null)} title={`Reject outside punch — ${rejecting?.employee.fullName ?? ""}`}>
        {rejecting && (
          <RejectForm
            key={rejecting.id}
            row={rejecting}
            onClose={() => setRejecting(null)}
            onDone={() => {
              setRejecting(null);
              load();
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

function RejectForm({ row, onClose, onDone }: { row: UnverifiedRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [checkIn, setCheckIn] = useState(() => toIstLocalInput(row.checkInAt));
  const [checkOut, setCheckOut] = useState(() => toIstLocalInput(row.checkOutAt));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/api/v1/attendance/outdoor/${row.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason, trimmedCheckInAt: fromIstLocalInput(checkIn), trimmedCheckOutAt: fromIstLocalInput(checkOut) }),
      });
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
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Punched {fmtTime(row.checkInAt)}–{fmtTime(row.checkOutAt)}. Set the times you will allow; the originals are kept and come back if you later approve the employee&apos;s explanation.
      </p>
      <FormField label="Reason" htmlFor="rej-reason" required>
        <textarea id="rej-reason" rows={2} className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Allowed check-in" htmlFor="rej-in" required>
          <input id="rej-in" type="datetime-local" className={textInputClass()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </FormField>
        <FormField label="Allowed check-out" htmlFor="rej-out" required>
          <input id="rej-out" type="datetime-local" className={textInputClass()} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </FormField>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={submit} isLoading={saving} loadingLabel="Saving…" disabled={!reason.trim() || !checkIn || !checkOut}>
          Reject & trim
        </Button>
      </div>
    </div>
  );
}

function RejectionsTab({ canApprove, canReject }: { canApprove: boolean; canReject: boolean }) {
  const [status, setStatus] = useState("IN_PROCESS");
  const [rows, setRows] = useState<OutdoorRejectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<{ row: OutdoorRejectionRow; kind: "approve" | "reject" | "cancel" } | null>(null);

  const load = useCallback(() => {
    apiJson<OutdoorRejectionRow[]>(`/api/v1/attendance/outdoor-rejections${status ? `?status=${status}` : ""}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    if (!action) return;
    const a = action;
    setAction(null);
    try {
      await apiJson(`/api/v1/attendance/outdoor-rejections/${a.row.id}/${a.kind}`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirmText = {
    approve: { title: "Approve the explanation?", message: "The employee's original punch times will be restored.", label: "Approve & restore" },
    reject: { title: "Reject the explanation?", message: "The trimmed times stay.", label: "Reject" },
    cancel: { title: "Cancel this rejection?", message: "The original punch times will be restored.", label: "Cancel rejection" },
  };

  return (
    <Card
      actions={
        <select className={`${textInputClass()} max-w-[14rem]`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="IN_PROCESS">Clarification sent</option>
          <option value="PENDING">Waiting for employee</option>
          <option value="APPROVED">Closed</option>
          <option value="REJECTED">Clarification rejected</option>
          <option value="">All</option>
        </select>
      }
    >
      <ErrorText message={error} />
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing here.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{r.employee.fullName}</span> <span className="text-xs text-zinc-500">{r.employee.employeeCode}</span> ·{" "}
                  {fmtDateTime(r.originalCheckIn)}
                </div>
                <OutdoorStatusPill status={r.status} revoked={r.isRevoked} />
              </div>
              <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                Original {fmtTime(r.originalCheckIn)}–{fmtTime(r.originalCheckOut)} · Allowed {fmtTime(r.trimmedCheckIn)}–{fmtTime(r.trimmedCheckOut)} · Rejected by {r.rejectedBy.fullName}
              </div>
              {r.rejectedReason && <div className="mt-1">Reason: {r.rejectedReason}</div>}
              {r.clarificationReason && <div className="mt-1">Employee&apos;s explanation: {r.clarificationReason}</div>}
              {r.hasProof && (
                <a className="mt-1 inline-block text-indigo-600 hover:underline" href={`/api/v1/attendance/outdoor-rejections/${r.id}/proof`} target="_blank" rel="noreferrer">
                  View proof
                </a>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status === "IN_PROCESS" && canApprove && (
                  <Button size="xs" variant="success" onClick={() => setAction({ row: r, kind: "approve" })}>
                    Approve & restore times
                  </Button>
                )}
                {r.status === "IN_PROCESS" && canReject && (
                  <Button size="xs" variant="danger" onClick={() => setAction({ row: r, kind: "reject" })}>
                    Reject explanation
                  </Button>
                )}
                {(r.status === "PENDING" || r.status === "IN_PROCESS") && canApprove && (
                  <Button size="xs" variant="secondary" onClick={() => setAction({ row: r, kind: "cancel" })}>
                    Cancel rejection
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmModal
        open={action !== null}
        title={action ? confirmText[action.kind].title : ""}
        message={action ? confirmText[action.kind].message : ""}
        confirmLabel={action ? confirmText[action.kind].label : ""}
        isDangerous={action?.kind === "reject"}
        onConfirm={run}
        onCancel={() => setAction(null)}
      />
    </Card>
  );
}

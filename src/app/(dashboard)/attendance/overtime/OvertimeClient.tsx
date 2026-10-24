"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDbDate, fmtHours, todayIst } from "../_shared/attendance-ui";
import { OvertimeStatusPill } from "../my/MyOvertimeList";

interface Row {
  id: string;
  attendanceDate: string;
  hours: number;
  workedHours: number;
  shiftHours: number;
  status: string;
  rejectionReason: string | null;
  ratePerHour: number;
  amount: number;
  employee: { fullName: string; employeeCode: string };
  decidedBy: { fullName: string } | null;
}

export function OvertimeClient({ canApprove, canReject }: { canApprove: boolean; canReject: boolean }) {
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [status, setStatus] = useState("PENDING");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<Row | null>(null);
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    const qs = new URLSearchParams({ month });
    if (status) qs.set("status", status);
    apiJson<Row[]>(`/api/v1/attendance/overtime?${qs}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month, status]);
  useEffect(() => {
    load();
  }, [load]);

  const approve = async () => {
    const r = approving;
    setApproving(null);
    if (!r) return;
    try {
      await apiJson(`/api/v1/attendance/overtime/${r.id}/approve`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reject = async () => {
    const r = rejecting;
    if (!r) return;
    try {
      await apiJson(`/api/v1/attendance/overtime/${r.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      setRejecting(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance", href: "/attendance" }, { label: "Overtime" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Overtime</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Calculated when an employee punches out: hours worked minus shift hours, only for employees with an overtime rate. Approved overtime is paid in the salary sheet.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <select className={`${textInputClass()} max-w-[12rem]`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <ErrorText message={error} />
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-zinc-500">
                <th className="px-2 py-2">Employee</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Worked</th>
                <th className="px-2 py-2">Shift</th>
                <th className="px-2 py-2">Overtime</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-zinc-500">
                    No overtime records.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.employee.fullName}</div>
                    <div className="text-xs text-zinc-500">{r.employee.employeeCode}</div>
                  </td>
                  <td className="px-2 py-2">{fmtDbDate(r.attendanceDate)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtHours(r.workedHours)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtHours(r.shiftHours)}</td>
                  <td className="px-2 py-2 font-medium tabular-nums">{fmtHours(r.hours)}</td>
                  <td className="px-2 py-2 tabular-nums">
                    ₹{r.amount.toLocaleString("en-IN")} <span className="text-xs text-zinc-500">@ ₹{r.ratePerHour}/h</span>
                  </td>
                  <td className="px-2 py-2">
                    <OvertimeStatusPill status={r.status} />
                    {r.decidedBy && <div className="text-xs text-zinc-500">by {r.decidedBy.fullName}</div>}
                    {r.rejectionReason && <div className="text-xs text-zinc-500">{r.rejectionReason}</div>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {r.status === "PENDING" && (
                      <div className="flex justify-end gap-2">
                        {canApprove && (
                          <Button size="xs" variant="success" onClick={() => setApproving(r)}>
                            Approve
                          </Button>
                        )}
                        {canReject && (
                          <Button
                            size="xs"
                            variant="danger"
                            onClick={() => {
                              setRejecting(r);
                              setReason("");
                            }}
                          >
                            Reject
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <ConfirmModal
        open={approving !== null}
        title="Approve this overtime?"
        message={approving ? `${fmtHours(approving.hours)} for ${approving.employee.fullName} — ₹${approving.amount.toLocaleString("en-IN")}.` : ""}
        confirmLabel="Approve"
        onConfirm={approve}
        onCancel={() => setApproving(null)}
      />
      <Modal open={rejecting !== null} onClose={() => setRejecting(null)} title="Reject overtime">
        <div className="space-y-3">
          <FormField label="Reason" htmlFor="ot-reason" required>
            <textarea id="ot-reason" rows={2} className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reject} disabled={!reason.trim()}>
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

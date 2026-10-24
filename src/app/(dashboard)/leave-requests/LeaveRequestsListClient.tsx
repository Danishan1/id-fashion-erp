"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { RowAction } from "@/components/ui/RowAction";
import { ApproveIcon, RejectIcon } from "@/components/ui/icons";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "@/lib/hr-approval-status-labels";
import { apiJson, ErrorText, fmtDbDate, Pill, Tabs, todayIst } from "../attendance/_shared/attendance-ui";
import { useScopedEmployees } from "../attendance/_shared/useScopedEmployees";

interface LeaveDayRow {
  id: string;
  leaveDate: string;
  durationType: string;
  fraction: string | number;
  isSandwich: boolean;
  paymentType: "PAID" | "NOT_PAID" | null;
  taken: boolean;
}

interface LeaveRequestRow {
  id: string;
  startDate: string;
  endDate: string;
  status: keyof typeof STATUS_LABELS;
  reason: string | null;
  rejectionReason: string | null;
  employee: { fullName: string; employeeCode: string };
  leaveType: { name: string };
  days: LeaveDayRow[];
}

const DURATIONS = [
  { value: "FULL", label: "Full day" },
  { value: "F_HALF", label: "First half" },
  { value: "S_HALF", label: "Second half" },
  { value: "QR1", label: "Quarter 1" },
  { value: "QR2", label: "Quarter 2" },
  { value: "QR3", label: "Quarter 3" },
  { value: "QR4", label: "Quarter 4" },
];
const FRACTION: Record<string, number> = { FULL: 1, F_HALF: 0.5, S_HALF: 0.5, QR1: 0.25, QR2: 0.25, QR3: 0.25, QR4: 0.25 };

function daysSummary(row: LeaveRequestRow) {
  if (!row.days?.length) return "—";
  const taken = row.days.filter((d) => d.taken);
  const total = taken.reduce((s, d) => s + Number(d.fraction), 0);
  const unpaid = taken.filter((d) => d.paymentType === "NOT_PAID").reduce((s, d) => s + Number(d.fraction), 0);
  const sandwich = taken.filter((d) => d.isSandwich).length;
  const notTaken = row.days.length - taken.length;
  return [`${total} day(s)`, unpaid ? `${unpaid} unpaid` : null, sandwich ? `${sandwich} sandwich` : null, notTaken ? `${notTaken} not taken` : null].filter(Boolean).join(" · ");
}

type TabId = "mine" | "team";

export function LeaveRequestsListClient({ canApprove, canReject, canManageTeam }: { canApprove: boolean; canReject: boolean; canManageTeam: boolean }) {
  const [tab, setTab] = useState<TabId>("mine");
  const [refreshKey, setRefreshKey] = useState(0);
  const [applying, setApplying] = useState(false);
  const [approveTarget, setApproveTarget] = useState<LeaveRequestRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    const r = approveTarget;
    setApproveTarget(null);
    if (!r) return;
    try {
      await apiJson(`/api/v1/leave-requests/${r.id}/approve`, { method: "POST" });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reject = async () => {
    if (!rejectTarget) return;
    try {
      await apiJson(`/api/v1/leave-requests/${rejectTarget.id}/reject`, { method: "POST", body: JSON.stringify({ reason: rejectReason }) });
      setRejectTarget(null);
      setRejectReason("");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leave Requests" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leave Requests</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Apply day by day (full, half or quarter day). On approval each day is paid from that month&apos;s quota, then from carried-forward leave; when neither covers it, the day is unpaid.
          </p>
        </div>
        <Button onClick={() => setApplying(true)}>Apply Leave</Button>
      </div>
      {canManageTeam && (
        <Tabs<TabId>
          tabs={[
            { id: "mine", label: "My leaves" },
            { id: "team", label: "Team leaves" },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      <ErrorText message={error} />
      <DataTable<LeaveRequestRow>
        key={`${tab}-${refreshKey}`}
        fetchUrl="/api/v1/leave-requests"
        extraParams={tab === "mine" ? { mine: "true" } : undefined}
        searchPlaceholder="Search by employee name…"
        columns={[
          { key: "employee", header: "Employee", render: (row) => `${row.employee.fullName} (${row.employee.employeeCode})` },
          { key: "leaveType", header: "Type", render: (row) => row.leaveType.name },
          { key: "dates", header: "Dates", render: (row) => `${fmtDbDate(row.startDate)} – ${fmtDbDate(row.endDate)}` },
          { key: "days", header: "Days", render: (row) => <span title={row.days?.map((d) => `${d.leaveDate.slice(0, 10)} ${d.durationType}${d.isSandwich ? " (sandwich)" : ""}${d.paymentType ? ` ${d.paymentType}` : ""}`).join("\n")}>{daysSummary(row)}</span> },
          { key: "reason", header: "Reason", render: (row) => row.rejectionReason ? `${row.reason ?? "—"} · Rejected: ${row.rejectionReason}` : row.reason ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (row) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>{STATUS_LABELS[row.status] ?? row.status}</span>,
          },
          {
            key: "actions",
            header: "Actions",
            render: (row) =>
              row.status === "PENDING" && tab === "team" ? (
                <div className="flex gap-3">
                  {canApprove && <RowAction icon={<ApproveIcon />} label="Approve" variant="success" onClick={() => setApproveTarget(row)} />}
                  {canReject && <RowAction icon={<RejectIcon />} label="Reject" variant="danger" onClick={() => setRejectTarget(row)} />}
                </div>
              ) : null,
          },
        ]}
      />
      <Modal open={applying} onClose={() => setApplying(false)} title="Apply Leave" maxWidthClass="max-w-2xl">
        {applying && (
          <ApplyLeaveForm
            canApplyForOthers={canManageTeam}
            onClose={() => setApplying(false)}
            onDone={() => {
              setApplying(false);
              setRefreshKey((k) => k + 1);
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={approveTarget !== null}
        title="Approve this leave?"
        message={approveTarget ? `${approveTarget.employee.fullName}: ${daysSummary(approveTarget)}. Days not covered by the balance will be unpaid.` : ""}
        confirmLabel="Approve"
        onConfirm={approve}
        onCancel={() => setApproveTarget(null)}
      />
      <Modal open={rejectTarget !== null} onClose={() => setRejectTarget(null)} title="Reject leave request">
        <div className="space-y-3">
          <FormField label="Reason" htmlFor="leave-reject" required>
            <textarea id="leave-reject" rows={2} className={textInputClass()} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
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

interface DayInfo {
  date: string;
  weekday: string;
  isWeekend: boolean;
  holidayName: string | null;
  existingLeave: string | null;
}

interface BalanceRow {
  id: string;
  leaveType: { id: string; name: string };
  remaining: number;
  carryForward: number;
  available: number;
}

function ApplyLeaveForm({ canApplyForOthers, onClose, onDone }: { canApplyForOthers: boolean; onClose: () => void; onDone: () => void }) {
  const { options: employeeOptions } = useScopedEmployees();
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(todayIst());
  const [dayInfo, setDayInfo] = useState<DayInfo[]>([]);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [sandwich, setSandwich] = useState(false);
  const [reason, setReason] = useState("");
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/leave-types")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setLeaveTypes((b.data ?? []).filter((t: { isActive: boolean }) => t.isActive)))
      .catch(() => setLeaveTypes([]));
  }, []);

  useEffect(() => {
    if (!from || !to || to < from) return;
    const qs = new URLSearchParams({ from, to });
    if (employeeId) qs.set("employeeId", employeeId);
    apiJson<{ days: DayInfo[] }>(`/api/v1/leave-requests/day-info?${qs}`)
      .then((r) => {
        setDayInfo(r.days);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [employeeId, from, to]);

  useEffect(() => {
    const qs = new URLSearchParams({ month: from.slice(0, 7) });
    if (employeeId) qs.set("employeeId", employeeId);
    else qs.set("mine", "true");
    apiJson<BalanceRow[]>(`/api/v1/leave-balances?${qs}`)
      .then(setBalances)
      .catch(() => setBalances([]));
  }, [employeeId, from]);

  const selectable = dayInfo.filter((d) => !d.isWeekend && !d.holidayName && !d.existingLeave);
  const total = selectable.reduce((s, d) => s + (FRACTION[durations[d.date] ?? "FULL"] ?? 1), 0);
  const balance = balances.find((b) => b.leaveType.id === leaveTypeId);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiJson("/api/v1/leave-requests", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId || undefined,
          leaveTypeId,
          days: selectable.map((d) => ({ date: d.date, duration: durations[d.date] ?? "FULL" })),
          includeSandwich: sandwich,
          reason,
        }),
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
      {canApplyForOthers && (
        <FormField label="Employee (leave empty for yourself)" htmlFor="leave-emp">
          <SearchableSelect id="leave-emp" options={employeeOptions} value={employeeId} onChange={setEmployeeId} placeholder="Myself" emptyOptionLabel="Myself" />
        </FormField>
      )}
      <FormField label="Leave type" htmlFor="leave-type" required>
        <select id="leave-type" className={textInputClass()} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          <option value="">Select…</option>
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      {balance && (
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          Balance for {from.slice(0, 7)}: {balance.remaining} this month + {balance.carryForward} carried forward = <b>{balance.available}</b> day(s). This request: {total} day(s)
          {total > balance.available && <span className="text-amber-700"> — {Math.round((total - balance.available) * 100) / 100} day(s) will be unpaid</span>}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="From" htmlFor="leave-from" required>
          <input id="leave-from" type="date" className={textInputClass()} value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="To" htmlFor="leave-to" required>
          <input id="leave-to" type="date" className={textInputClass()} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>
      {dayInfo.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {dayInfo.map((d) => (
                <tr key={d.date}>
                  <td className="px-3 py-1.5 tabular-nums">
                    {fmtDbDate(d.date)} <span className="text-xs text-zinc-500">{d.weekday.slice(0, 3)}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {d.holidayName ? (
                      <Pill>Holiday: {d.holidayName}</Pill>
                    ) : d.isWeekend ? (
                      <Pill>Weekly off</Pill>
                    ) : d.existingLeave ? (
                      <Pill tone="blue">Already applied</Pill>
                    ) : (
                      <select className={`${textInputClass()} py-1`} value={durations[d.date] ?? "FULL"} onChange={(e) => setDurations({ ...durations, [d.date]: e.target.value })}>
                        {DURATIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={sandwich} onChange={(e) => setSandwich(e.target.checked)} />
        <span>Include sandwich days — weekly offs that fall between two leave days are added as leave too (e.g. Saturday + Monday adds Sunday).</span>
      </label>
      <FormField label="Reason" htmlFor="leave-reason">
        <textarea id="leave-reason" rows={2} className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} isLoading={saving} loadingLabel="Applying…" disabled={!leaveTypeId || selectable.length === 0}>
          Apply ({total} day{total === 1 ? "" : "s"})
        </Button>
      </div>
    </div>
  );
}

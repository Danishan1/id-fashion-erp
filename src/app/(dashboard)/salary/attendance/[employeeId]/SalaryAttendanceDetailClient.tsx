"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDateTime, fmtHours, fmtTime, Pill } from "../../../attendance/_shared/attendance-ui";
import { ADJUSTMENT_MODE_LABELS, previousMonthKey } from "../salary-attendance-ui";

interface Day {
  dateKey: string;
  weekday: string;
  isFuture: boolean;
  isPreJoining: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isWeekend: boolean;
  isSandwich: boolean;
  firstIn: string | null;
  lastOut: string | null;
  workedHours: number;
  actualWorkedHours: number;
  expectedHours: number;
  leaveFraction: number;
  leaveLabel: string | null;
  present: number;
  absent: number;
  code: string;
  salaryAdjustment: { id: string; mode: string; hours: number | null; reason: string } | null;
}

interface LeaveDayRow {
  id: string;
  dateKey: string;
  leaveType: string;
  fraction: number;
  paymentType: "PAID" | "NOT_PAID";
  changes: { fromType: string; toType: string; reason: string; at: string; by: string | null }[];
}

interface LogRow {
  id: string;
  dateKey: string;
  mode: string;
  hours: number | null;
  actualHours: number;
  reason: string;
  at: string;
  by: string | null;
  removedAt: string | null;
  removedBy: string | null;
  removeReason: string | null;
}

interface Detail {
  employee: { id: string; employeeCode: string; fullName: string; shift: { name: string; startTime: string; endTime: string } | null };
  summary: {
    workingDays: number;
    workedDays: number;
    actualHours: number;
    adjustedHours: number;
    expectedHours: number;
    paidWeekends: number;
    companyHolidays: number;
    presentDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    absentDays: number;
    extraPayableDays: number;
    sandwichDays: number;
  };
  days: Day[];
  leaveDays: LeaveDayRow[];
  adjustmentLog: LogRow[];
}

const CODE_LABEL: Record<string, string> = {
  P: "Present",
  SP: "Present ¾",
  HP: "Half day",
  LH: "Low hours",
  A: "Absent",
  L: "Leave",
  H: "Holiday",
  W: "Weekly off",
  S: "Sandwich",
  "-": "—",
};
const CODE_TONE: Record<string, "green" | "amber" | "red" | "blue" | "zinc" | "purple"> = {
  P: "green",
  SP: "amber",
  HP: "amber",
  LH: "red",
  A: "red",
  L: "purple",
  H: "blue",
  W: "blue",
  S: "red",
  "-": "zinc",
};

const canAdjust = (d: Day) => !d.isFuture && !d.isPreJoining && !d.isHoliday && !d.isWeekend && d.leaveFraction < 1;
const dateLabel = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });

export function SalaryAttendanceDetailClient({ employeeId, initialMonth, canEdit }: { employeeId: string; initialMonth: string | null; canEdit: boolean }) {
  const [month, setMonth] = useState(initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : previousMonthKey());
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"FIXED_HOURS" | "OFFICE_TIME" | "FULL_DAY">("FIXED_HOURS");
  const [hours, setHours] = useState("9");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<LeaveDayRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Day | null>(null);
  const [modalReason, setModalReason] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<Detail>(`/api/v1/salary/attendance/${employeeId}?month=${month}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [employeeId, month]);

  useEffect(load, [load]);

  async function run(fn: () => Promise<Detail>, after?: () => void) {
    setBusy(true);
    try {
      setData(await fn());
      setError(null);
      after?.();
    } catch (e) {
      const msg = (e as Error).message;
      if (leaveTarget || removeTarget) setModalError(msg);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function applyBulk() {
    run(
      () =>
        apiJson<Detail>(`/api/v1/salary/attendance/${employeeId}/adjust`, {
          method: "POST",
          body: JSON.stringify({ dates: [...selected], mode, hours: mode === "FIXED_HOURS" ? hours : undefined, reason }),
        }),
      () => {
        setSelected(new Set());
        setReason("");
      }
    );
  }

  const closeModals = () => {
    setLeaveTarget(null);
    setRemoveTarget(null);
    setModalReason("");
    setModalError(null);
  };

  if (error && !data) return <ErrorText message={error} />;
  if (!data) return <p className="text-sm text-zinc-500">Loading…</p>;

  const s = data.summary;
  const adjustable = data.days.filter(canAdjust);
  const allSelected = adjustable.length > 0 && adjustable.every((d) => selected.has(d.dateKey));
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const shortDays = adjustable.filter((d) => d.actualWorkedHours > 0 && d.actualWorkedHours < d.expectedHours && !d.salaryAdjustment);

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Manage Attendance", href: `/salary/attendance` }, { label: data.employee.fullName }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {data.employee.fullName} <span className="text-sm font-normal text-zinc-500">{data.employee.employeeCode}</span>
          </h1>
          <p className="text-sm text-zinc-500">{data.employee.shift ? `${data.employee.shift.name} (${data.employee.shift.startTime}–${data.employee.shift.endTime})` : "No shift — 8 hours a day"}</p>
        </div>
        <input
          type="month"
          className={`${textInputClass()} w-44`}
          value={month}
          onChange={(e) => {
            if (!e.target.value) return;
            setData(null);
            setSelected(new Set());
            setMonth(e.target.value);
          }}
        />
      </div>

      <ErrorText message={error} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Working Days" value={`${s.workedDays} / ${s.workingDays}`} hint="Days worked / working days" />
        <Stat
          label="Total Worked Hours"
          value={`${fmtHours(s.adjustedHours)} / ${fmtHours(s.expectedHours)}`}
          hint={s.adjustedHours !== s.actualHours ? `Monthly Total · actual ${fmtHours(s.actualHours)}` : "Monthly Total"}
        />
        <Stat label="Paid Weekends" value={String(s.paidWeekends)} hint="Weekly offs credited" />
        <Stat label="Company Holidays" value={String(s.companyHolidays)} hint="Holidays credited" />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        For salary: Present <b>{s.presentDays}</b> · Paid leave <b>{s.paidLeaveDays}</b> · Unpaid leave <b>{s.unpaidLeaveDays}</b> · Absent <b>{s.absentDays}</b> · Extra days <b>{s.extraPayableDays}</b>
        {s.sandwichDays > 0 && <> · Sandwich <b>{s.sandwichDays}</b></>}
      </p>

      {canEdit && (
        <Card title={selected.size ? `${selected.size} day(s) selected` : "Bulk adjust"}>
          <p className="mb-3 text-sm text-zinc-500">
            Tick working days below, then choose how salary should count them. Only salary is affected — punches stay as they are.
            {shortDays.length > 0 && (
              <>
                {" "}
                <button type="button" className="font-medium text-indigo-600 hover:text-indigo-500" onClick={() => setSelected(new Set(shortDays.map((d) => d.dateKey)))}>
                  Select {shortDays.length} short day(s)
                </button>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Count as" htmlFor="adj-mode">
              <select id="adj-mode" className={textInputClass()} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="FIXED_HOURS">Fixed hours</option>
                <option value="OFFICE_TIME">Office time (shift hours)</option>
                <option value="FULL_DAY">Full day</option>
              </select>
            </FormField>
            {mode === "FIXED_HOURS" && (
              <FormField label="Hours" htmlFor="adj-hours">
                <input id="adj-hours" type="number" min={0.25} max={24} step="0.25" className={`${textInputClass()} w-24`} value={hours} onChange={(e) => setHours(e.target.value)} />
              </FormField>
            )}
            <div className="min-w-64 flex-1">
              <FormField label="Reason" htmlFor="adj-reason" required>
                <input id="adj-reason" className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Left 20 minutes early, approved as full day" />
              </FormField>
            </div>
            <Button onClick={applyBulk} isLoading={busy} disabled={selected.size === 0 || reason.trim().length < 3}>
              Apply to {selected.size || "selected"} day(s)
            </Button>
          </div>
        </Card>
      )}

      <Card title="Days">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                {canEdit && (
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all working days"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(adjustable.map((d) => d.dateKey)))}
                    />
                  </th>
                )}
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">In / Out</th>
                <th className="px-2 py-2 text-right">Worked</th>
                <th className="px-2 py-2 text-right">Counted for salary</th>
                <th className="px-2 py-2">Leave</th>
                <th className="px-2 py-2">Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.dateKey} className={`border-b border-zinc-100 dark:border-zinc-800 ${d.isFuture || d.isPreJoining ? "opacity-50" : ""}`}>
                  {canEdit && (
                    <td className="px-2 py-2">
                      {canAdjust(d) && <input type="checkbox" aria-label={`Select ${d.dateKey}`} checked={selected.has(d.dateKey)} onChange={() => toggle(d.dateKey)} />}
                    </td>
                  )}
                  <td className="px-2 py-2 whitespace-nowrap">
                    {dateLabel(d.dateKey)} <span className="text-xs text-zinc-500">{d.weekday.slice(0, 3)}</span>
                  </td>
                  <td className="px-2 py-2">
                    <Pill tone={CODE_TONE[d.code] ?? "zinc"}>{d.isPreJoining ? "Not joined" : d.isFuture ? "Upcoming" : CODE_LABEL[d.code] ?? d.code}</Pill>
                    {d.holidayName && <span className="ml-1 text-xs text-zinc-500">{d.holidayName}</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-xs">{d.firstIn ? `${fmtTime(d.firstIn)} – ${d.lastOut ? fmtTime(d.lastOut) : "open"}` : "—"}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${canAdjust(d) && d.actualWorkedHours > 0 && d.actualWorkedHours < d.expectedHours ? "text-amber-600" : ""}`}>
                    {d.actualWorkedHours > 0 ? fmtHours(d.actualWorkedHours) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {d.salaryAdjustment ? <b>{d.salaryAdjustment.mode === "FULL_DAY" ? "Full day" : fmtHours(d.workedHours)}</b> : d.present > 0 ? `${d.present} day` : "—"}
                  </td>
                  <td className="px-2 py-2 text-xs">{d.leaveLabel ? `${d.leaveLabel} (${d.leaveFraction})` : ""}</td>
                  <td className="px-2 py-2 text-xs">
                    {d.salaryAdjustment && (
                      <span className="inline-flex items-center gap-2">
                        <Pill tone="purple">{ADJUSTMENT_MODE_LABELS[d.salaryAdjustment.mode]}</Pill>
                        <span className="max-w-48 truncate text-zinc-500" title={d.salaryAdjustment.reason}>
                          {d.salaryAdjustment.reason}
                        </span>
                        {canEdit && (
                          <button type="button" className="text-red-600 hover:text-red-500" onClick={() => setRemoveTarget(d)}>
                            Remove
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Leave this month">
        {data.leaveDays.length === 0 ? (
          <p className="text-sm text-zinc-500">No approved leave this month.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2 text-right">Days</th>
                <th className="px-2 py-2">Pay</th>
                <th className="px-2 py-2">History</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.leaveDays.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-2">{dateLabel(l.dateKey)}</td>
                  <td className="px-2 py-2">{l.leaveType}</td>
                  <td className="px-2 py-2 text-right">{l.fraction}</td>
                  <td className="px-2 py-2">{l.paymentType === "PAID" ? <Pill tone="green">Paid</Pill> : <Pill tone="red">Unpaid</Pill>}</td>
                  <td className="px-2 py-2 text-xs text-zinc-500">
                    {l.changes.map((c, i) => (
                      <div key={i}>
                        {c.fromType === "PAID" ? "Paid" : "Unpaid"} → {c.toType === "PAID" ? "Paid" : "Unpaid"} by {c.by} · {fmtDateTime(c.at)} · {c.reason}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {canEdit && (
                      <Button variant="secondary" size="xs" onClick={() => setLeaveTarget(l)}>
                        Make {l.paymentType === "PAID" ? "unpaid" : "paid"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Adjustment history">
        {data.adjustmentLog.length === 0 ? (
          <p className="text-sm text-zinc-500">No adjustments this month.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.adjustmentLog.map((a) => (
              <li key={a.id} className={a.removedAt ? "text-zinc-400 line-through decoration-zinc-300" : ""}>
                {dateLabel(a.dateKey)} — {ADJUSTMENT_MODE_LABELS[a.mode]}
                {a.hours !== null ? ` ${fmtHours(a.hours)}` : ""} (actual {fmtHours(a.actualHours)}) · {a.reason} · by {a.by}, {fmtDateTime(a.at)}
                {a.removedAt && (
                  <span className="no-underline">
                    {" "}
                    · removed by {a.removedBy}, {fmtDateTime(a.removedAt)}
                    {a.removeReason ? ` (${a.removeReason})` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={Boolean(leaveTarget)} onClose={closeModals} title={leaveTarget ? `Make leave on ${dateLabel(leaveTarget.dateKey)} ${leaveTarget.paymentType === "PAID" ? "unpaid" : "paid"}` : ""}>
        {leaveTarget && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {leaveTarget.paymentType === "PAID"
                ? `${leaveTarget.fraction} day(s) will go back to the ${leaveTarget.leaveType} balance, and the day will be deducted from salary.`
                : `${leaveTarget.fraction} day(s) will be taken from the ${leaveTarget.leaveType} balance (this month first, then carry-forward). Refused if the balance is not enough.`}
            </p>
            <FormField label="Reason" htmlFor="leave-reason" required>
              <input id="leave-reason" className={textInputClass()} value={modalReason} onChange={(e) => setModalReason(e.target.value)} />
            </FormField>
            <ErrorText message={modalError} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModals}>
                Cancel
              </Button>
              <Button
                isLoading={busy}
                disabled={modalReason.trim().length < 3}
                onClick={() =>
                  run(
                    () => apiJson<Detail>(`/api/v1/salary/leave-days/${leaveTarget.id}/payment`, { method: "POST", body: JSON.stringify({ to: leaveTarget.paymentType === "PAID" ? "NOT_PAID" : "PAID", reason: modalReason }) }),
                    closeModals
                  )
                }
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(removeTarget)} onClose={closeModals} title={removeTarget ? `Remove adjustment on ${dateLabel(removeTarget.dateKey)}` : ""}>
        {removeTarget?.salaryAdjustment && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Salary will count this day by its real hours ({fmtHours(removeTarget.actualWorkedHours)}) again. The adjustment stays in the history.</p>
            <FormField label="Reason (optional)" htmlFor="remove-reason">
              <input id="remove-reason" className={textInputClass()} value={modalReason} onChange={(e) => setModalReason(e.target.value)} />
            </FormField>
            <ErrorText message={modalError} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModals}>
                Cancel
              </Button>
              <Button
                variant="danger"
                isLoading={busy}
                onClick={() =>
                  run(
                    () => apiJson<Detail>(`/api/v1/salary/attendance-adjustments/${removeTarget.salaryAdjustment!.id}/remove`, { method: "POST", body: JSON.stringify({ reason: modalReason }) }),
                    closeModals
                  )
                }
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </div>
  );
}

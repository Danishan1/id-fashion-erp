"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { apiJson, Card, ErrorText, fmtDateTime, Pill } from "../../attendance/_shared/attendance-ui";
import { previousMonthKey } from "../attendance/salary-attendance-ui";

interface Amounts {
  perDay: number;
  allowances: number;
  overtimePay: number;
  gross: number;
  paidDays: number;
  earnedGross: number;
  earnedBase: number;
  earnedComponents: { kind: string; title: string; rate: number; amount: number }[];
  leavePaymentAmount: number;
  extraDaysAmount: number;
  pf: number;
  esic: number;
  otherDeductions: number;
  installment: number;
  tds: number;
  surcharge: number;
  educationCess: number;
  lateFeeInterest: number;
  arrears: number;
  totalDeductions: number;
  net: number;
}

interface Line {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  calendarDays: number;
  system: { presentDays: number; paidLeaveDays: number; extraDays: number };
  presentDays: number;
  paidLeaveDays: number;
  extraDays: number;
  autoPaidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  weekendDays: number;
  holidayDays: number;
  overtimeHours: number;
  attendancePercent: number;
  hasNoPunches: boolean;
  arrearsAmount: number;
  arrearsReason: string | null;
  edited: boolean;
  amounts: Amounts;
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  edits: { field: string; oldValue: string | null; newValue: string | null; reason: string; at: string; by: string | null }[];
  paymentRequest: { id: string; requestNumber: string; status: string; paidAmount: number } | null;
}

interface SummaryRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  calendarDays: number;
  presentDays: number;
  paidLeaveDays: number;
  autoPaidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  weekendDays: number;
  holidayDays: number;
  extraDays: number;
  attendancePercent: number;
}

interface View {
  year: number;
  month: number;
  monthEnded: boolean;
  oldSheetFinalised: boolean;
  pendingRegularizations: number;
  missingSetup: { id: string; employeeCode: string; fullName: string }[];
  summary: SummaryRow[] | null;
  run: {
    id: string;
    status: "DRAFT" | "APPROVED" | "FINALISED";
    generatedAt: string;
    generatedBy: string | null;
    generatedByUserId: string;
    approvedAt: string | null;
    approvedBy: string | null;
    finalisedAt: string | null;
    finalisedBy: string | null;
    sentToAccountsAt: string | null;
    sentToAccountsBy: string | null;
    paidCount: number;
    totals: { gross: number; deductions: number; net: number };
    events: { action: string; reason: string | null; at: string; by: string | null }[];
    lines: Line[];
  } | null;
}

interface Can {
  generate: boolean;
  edit: boolean;
  approve: boolean;
  sendBack: boolean;
  finalise: boolean;
  reopen: boolean;
}

const money = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const STATUS_TONE = { DRAFT: "amber", APPROVED: "blue", FINALISED: "green" } as const;
const EVENT_LABEL: Record<string, string> = {
  GENERATED: "Generated",
  REGENERATED: "Regenerated",
  APPROVED: "Approved",
  SENT_BACK: "Sent back",
  FINALISED: "Finalised",
  REOPENED: "Reopened",
  SENT_TO_ACCOUNTS: "Sent to Accounts",
};
const PAY_STATUS: Record<string, string> = { APPROVED: "To pay", PARTIALLY_PAID: "Part paid", PAID: "Paid", CANCELLED: "Cancelled", PENDING_APPROVAL: "Pending", REJECTED: "Rejected" };
const FIELD_LABEL: Record<string, string> = { presentDays: "Present days", paidLeaveDays: "Paid leave days", extraDays: "Extra days", arrearsAmount: "Arrears" };

function Changed({ value, system }: { value: number; system: number }) {
  if (Math.abs(value - system) < 1e-9) return <>{value}</>;
  return (
    <span title={`By system: ${system}`} className="font-semibold text-indigo-600">
      {value}
      <span className="ml-1 text-xs font-normal text-zinc-400 line-through">{system}</span>
    </span>
  );
}

/** Salary Management → Generate Salary (slice 3). */
export function GenerateSalaryClient({ initialMonth, currentUserId, can }: { initialMonth: string | null; currentUserId: string; can: Can }) {
  const [month, setMonth] = useState(initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : previousMonthKey());
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editLine, setEditLine] = useState<Line | null>(null);
  const [detailLine, setDetailLine] = useState<Line | null>(null);
  const [reasonAction, setReasonAction] = useState<"send-back" | "reopen" | null>(null);
  const [form, setForm] = useState({ presentDays: "", paidLeaveDays: "", extraDays: "", arrearsAmount: "", arrearsReason: "", reason: "" });
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");

  const load = useCallback(() => {
    apiJson<View>(`/api/v1/salary/runs?month=${month}`)
      .then((d) => {
        setView(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [month]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<View>, onDone?: () => void, inModal = false) {
    setBusy(true);
    try {
      const v = await fn();
      // Generate / edit return the run view without the pre-run summary.
      setView({ ...v, summary: v.summary ?? null });
      setError(null);
      onDone?.();
    } catch (e) {
      if (inModal) setModalError((e as Error).message);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendToAccounts() {
    if (!view?.run) return;
    setBusy(true);
    try {
      const r = await apiJson<{ requests: number; failed: { employeeName: string; error: string }[] }>(`/api/v1/salary/runs/${view.run.id}/send-to-accounts`, { method: "POST", body: "{}" });
      setError(r.failed.length ? `${r.failed.length} request(s) could not be raised: ${r.failed.map((f) => `${f.employeeName} — ${f.error}`).join("; ")}` : null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const post = (url: string, body: unknown = {}) => apiJson<View>(url, { method: "POST", body: JSON.stringify(body) });

  function openEdit(l: Line) {
    setEditLine(l);
    setModalError(null);
    setForm({ presentDays: String(l.presentDays), paidLeaveDays: String(l.paidLeaveDays), extraDays: String(l.extraDays), arrearsAmount: String(l.arrearsAmount), arrearsReason: l.arrearsReason ?? "", reason: "" });
  }

  function openReason(action: "send-back" | "reopen") {
    setReasonAction(action);
    setActionReason("");
    setModalError(null);
  }

  if (error && !view) return <ErrorText message={error} />;
  if (!view) return <p className="text-sm text-zinc-500">Loading…</p>;

  const run = view.run;
  const blockers: string[] = [];
  if (!view.monthEnded) blockers.push("The month hasn't ended yet.");
  if (view.pendingRegularizations > 0) blockers.push(`${view.pendingRegularizations} regularization request(s) are pending.`);
  if (view.oldSheetFinalised) blockers.push("This month was already finalised on the old Salary Sheet.");
  const generatedByMe = run?.generatedByUserId === currentUserId;

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Generate Salary" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Generate Salary</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Generate the month&apos;s salary, adjust Present / Paid Leave / Extra Days / Arrears before approval, then approve and finalise. Edits here never change attendance.
          </p>
        </div>
        <input
          type="month"
          className={`${textInputClass()} w-44`}
          value={month}
          onChange={(e) => {
            if (!e.target.value) return;
            setView(null);
            setMonth(e.target.value);
          }}
        />
      </div>

      <ErrorText message={error} />

      {view.missingSetup.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {view.missingSetup.length} employee(s) have no salary setup and are left out:{" "}
          {view.missingSetup
            .slice(0, 6)
            .map((e) => e.fullName)
            .join(", ")}
          {view.missingSetup.length > 6 ? "…" : ""}.{" "}
          <Link href="/salary/setup" className="font-medium underline">
            Salary Setup
          </Link>
        </p>
      )}

      {!run && (
        <Card
          title="Attendance Summary"
          actions={
            can.generate && (
              <Button onClick={() => act(() => post("/api/v1/salary/runs", { month }))} isLoading={busy} disabled={blockers.length > 0 || !view.summary?.length}>
                Generate Salary
              </Button>
            )
          }
        >
          {blockers.length > 0 && <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{blockers.join(" ")}</p>}
          <p className="mb-3 text-xs text-zinc-500">
            Includes salary-only adjustments from{" "}
            <Link href={`/salary/attendance?month=${month}`} className="underline">
              Manage Attendance
            </Link>
            . Paid leave includes leave balance used for absent days (auto paid leave).
          </p>
          <SummaryTable rows={view.summary ?? []} />
        </Card>
      )}

      {run && (
        <>
          <Card
            title={
              <span className="flex items-center gap-2">
                Salary run <Pill tone={STATUS_TONE[run.status]}>{run.status === "FINALISED" ? "Finalised" : run.status === "APPROVED" ? "Approved" : "Draft"}</Pill>
              </span>
            }
            actions={
              <div className="flex flex-wrap gap-2">
                {run.status === "DRAFT" && can.generate && (
                  <Button variant="secondary" onClick={() => act(() => post("/api/v1/salary/runs", { month }))} isLoading={busy} disabled={blockers.length > 0}>
                    Regenerate
                  </Button>
                )}
                {run.status === "DRAFT" && can.approve && (
                  <Button onClick={() => act(() => post(`/api/v1/salary/runs/${run.id}/approve`))} isLoading={busy} title={generatedByMe ? "You generated this run — someone else has to approve it" : undefined}>
                    Approve
                  </Button>
                )}
                {run.status === "APPROVED" && can.sendBack && (
                  <Button variant="secondary" onClick={() => openReason("send-back")}>
                    Send back
                  </Button>
                )}
                {run.status === "APPROVED" && can.finalise && (
                  <Button variant="success" onClick={() => act(() => post(`/api/v1/salary/runs/${run.id}/finalise`))} isLoading={busy}>
                    Finalise
                  </Button>
                )}
                {run.status === "FINALISED" && can.finalise && run.lines.some((l) => l.netAmount > 0 && !l.paymentRequest) && (
                  <Button onClick={sendToAccounts} isLoading={busy}>
                    {run.sentToAccountsAt ? "Raise missing salary requests" : "Send to Accounts"}
                  </Button>
                )}
                {run.status === "FINALISED" && can.reopen && run.paidCount === 0 && (
                  <Button variant="danger" onClick={() => openReason("reopen")}>
                    Reopen
                  </Button>
                )}
              </div>
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Total label="Gross (earned + arrears)" value={money(run.totals.gross)} />
              <Total label="Deductions" value={money(run.totals.deductions)} />
              <Total label="Net payable" value={money(run.totals.net)} strong />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Generated by {run.generatedBy} · {fmtDateTime(run.generatedAt)}
              {run.approvedAt && ` · Approved by ${run.approvedBy} · ${fmtDateTime(run.approvedAt)}`}
              {run.finalisedAt && ` · Finalised by ${run.finalisedBy} · ${fmtDateTime(run.finalisedAt)}`}
              {run.sentToAccountsAt && ` · Sent to Accounts by ${run.sentToAccountsBy} · ${fmtDateTime(run.sentToAccountsAt)} · ${run.paidCount} of ${run.lines.filter((l) => l.paymentRequest).length} paid`}
            </p>
            {run.status !== "DRAFT" && <p className="mt-1 text-xs text-zinc-500">Attendance, leave and salary adjustments for this month are locked.</p>}
          </Card>

          <Card title={`${run.lines.length} employees`}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2 text-right">Present</th>
                    <th className="px-2 py-2 text-right">Holiday</th>
                    <th className="px-2 py-2 text-right">Weekend</th>
                    <th className="px-2 py-2 text-right">Paid Leave</th>
                    <th className="px-2 py-2 text-right">Unpaid Leave</th>
                    <th className="px-2 py-2 text-right">Absent</th>
                    <th className="px-2 py-2 text-right">Extra</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 text-right">Att. %</th>
                    <th className="px-2 py-2 text-right">Gross</th>
                    <th className="px-2 py-2 text-right">Deductions</th>
                    <th className="px-2 py-2 text-right">Arrears</th>
                    <th className="px-2 py-2 text-right">Net</th>
                    {run.sentToAccountsAt && <th className="px-2 py-2">Payment</th>}
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {run.lines.map((l) => (
                    <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-2">
                        <div className="font-medium">{l.employeeName}</div>
                        <div className="text-xs text-zinc-500">
                          {l.employeeCode}
                          {l.hasNoPunches && " · no punches"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <Changed value={l.presentDays} system={l.system.presentDays} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.holidayDays}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.weekendDays}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <Changed value={l.paidLeaveDays} system={l.system.paidLeaveDays} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.unpaidLeaveDays}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.absentDays}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <Changed value={l.extraDays} system={l.system.extraDays} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.calendarDays}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.attendancePercent}%</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(l.amounts.earnedGross)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(l.totalDeductions)}</td>
                      <td className="px-2 py-2 text-right tabular-nums" title={l.arrearsReason ?? undefined}>
                        {l.arrearsAmount ? money(l.arrearsAmount) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(l.netAmount)}</td>
                      {run.sentToAccountsAt && (
                        <td className="px-2 py-2 text-xs">
                          {l.paymentRequest ? (
                            <Link href={`/accounts/payment-requests/${l.paymentRequest.id}`} className="text-indigo-600 hover:text-indigo-500">
                              {l.paymentRequest.requestNumber} · {PAY_STATUS[l.paymentRequest.status] ?? l.paymentRequest.status}
                            </Link>
                          ) : l.netAmount > 0 ? (
                            <span className="text-amber-600">Not raised</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <button type="button" className="text-indigo-600 hover:text-indigo-500" onClick={() => setDetailLine(l)}>
                          View
                        </button>
                        {run.status === "DRAFT" && can.edit && (
                          <button type="button" className="ml-3 text-indigo-600 hover:text-indigo-500" onClick={() => openEdit(l)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="History">
            <ul className="space-y-1 text-sm">
              {run.events.map((e, i) => (
                <li key={i}>
                  {EVENT_LABEL[e.action] ?? e.action} by {e.by} · {fmtDateTime(e.at)}
                  {e.reason && <span className="text-zinc-500"> — {e.reason}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Modal open={Boolean(editLine)} onClose={() => setEditLine(null)} title={editLine ? `Edit ${editLine.employeeName}` : ""} maxWidthClass="max-w-lg">
        {editLine && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              Changes count only for this salary. Weekly offs {editLine.weekendDays}, holidays {editLine.holidayDays} of {editLine.calendarDays} days.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["presentDays", "Present days", editLine.system.presentDays],
                  ["paidLeaveDays", "Paid leave days", editLine.system.paidLeaveDays],
                  ["extraDays", "Extra days", editLine.system.extraDays],
                ] as const
              ).map(([key, label, system]) => (
                <FormField key={key} label={`${label} (system ${system})`} htmlFor={key}>
                  <input id={key} type="number" min={0} step="0.25" className={textInputClass()} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                </FormField>
              ))}
              <FormField label="Arrears (₹, minus to recover)" htmlFor="arrearsAmount">
                <input id="arrearsAmount" type="number" step="0.01" className={textInputClass()} value={form.arrearsAmount} onChange={(e) => setForm({ ...form, arrearsAmount: e.target.value })} />
              </FormField>
            </div>
            {Number(form.arrearsAmount) !== 0 && (
              <FormField label="Arrears reason" htmlFor="arrearsReason" required>
                <input id="arrearsReason" className={textInputClass()} value={form.arrearsReason} onChange={(e) => setForm({ ...form, arrearsReason: e.target.value })} />
              </FormField>
            )}
            <FormField label="Why are you changing this?" htmlFor="editReason" required>
              <input id="editReason" className={textInputClass()} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </FormField>
            <ErrorText message={modalError} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditLine(null)}>
                Cancel
              </Button>
              <Button
                isLoading={busy}
                disabled={form.reason.trim().length < 3}
                onClick={() => act(() => apiJson<View>(`/api/v1/salary/run-lines/${editLine.id}`, { method: "PATCH", body: JSON.stringify(form) }), () => setEditLine(null), true)}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(detailLine)} onClose={() => setDetailLine(null)} title={detailLine ? `${detailLine.employeeName} — salary` : ""} maxWidthClass="max-w-xl">
        {detailLine && <LineDetail line={detailLine} />}
      </Modal>

      <Modal open={Boolean(reasonAction)} onClose={() => setReasonAction(null)} title={reasonAction === "reopen" ? "Reopen finalised salary" : "Send salary back to draft"}>
        {run && reasonAction && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">
              {reasonAction === "reopen"
                ? "The run goes back to draft, the month is unlocked, and leave balance used for auto paid leave is given back. If it was sent to Accounts, the salary requests are cancelled and the accounting entry is reversed (not possible once any salary is paid)."
                : "The run goes back to draft so it can be corrected and approved again. The month is unlocked."}
            </p>
            <FormField label="Reason" htmlFor="actionReason" required>
              <input id="actionReason" className={textInputClass()} value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
            </FormField>
            <ErrorText message={modalError} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReasonAction(null)}>
                Cancel
              </Button>
              <Button
                variant={reasonAction === "reopen" ? "danger" : "primary"}
                isLoading={busy}
                disabled={actionReason.trim().length < 3}
                onClick={() => act(() => post(`/api/v1/salary/runs/${run.id}/${reasonAction}`, { reason: actionReason }), () => setReasonAction(null), true)}
              >
                {reasonAction === "reopen" ? "Reopen" : "Send back"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 tabular-nums ${strong ? "text-xl font-semibold text-zinc-900 dark:text-zinc-50" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">No employee has a salary setup yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <th className="px-2 py-2">Name</th>
            <th className="px-2 py-2 text-right">Present</th>
            <th className="px-2 py-2 text-right">Holiday</th>
            <th className="px-2 py-2 text-right">Weekend</th>
            <th className="px-2 py-2 text-right">Paid Leave</th>
            <th className="px-2 py-2 text-right">Unpaid Leave</th>
            <th className="px-2 py-2 text-right">Absent</th>
            <th className="px-2 py-2 text-right">Total</th>
            <th className="px-2 py-2 text-right">Attendance %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="px-2 py-2">
                {r.fullName} <span className="text-xs text-zinc-500">{r.employeeCode}</span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{r.presentDays}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.holidayDays}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.weekendDays}</td>
              <td className="px-2 py-2 text-right tabular-nums" title={r.autoPaidLeaveDays ? `${r.autoPaidLeaveDays} from leave balance` : undefined}>
                {r.paidLeaveDays}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{r.unpaidLeaveDays}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.absentDays}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.calendarDays}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.attendancePercent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineDetail({ line }: { line: Line }) {
  const a = line.amounts;
  const rows: [string, number][] = [
    ["Basic (earned)", a.earnedBase],
    ...a.earnedComponents.filter((c) => c.kind === "ALLOWANCE").map((c) => [`${c.title} (earned of ${money(c.rate)})`, c.amount] as [string, number]),
    ["Overtime pay (in gross)", a.overtimePay],
    ["Earned gross", a.earnedGross],
    ["Arrears", a.arrears],
  ];
  const deductions: [string, number][] = [
    ["PF", a.pf],
    ["ESIC", a.esic],
    ...a.earnedComponents.filter((c) => c.kind === "DEDUCTION").map((c) => [c.title, c.amount] as [string, number]),
    ["Advance installment", a.installment],
    ["TDS", a.tds],
    ["Surcharge", a.surcharge],
    ["Education cess", a.educationCess],
    ["Interest on late fees", a.lateFeeInterest],
  ];
  return (
    <div className="space-y-4 text-sm">
      <p className="text-zinc-500">
        Paid days {a.paidDays} of {line.calendarDays} (present {line.presentDays} + weekly offs {line.weekendDays} + holidays {line.holidayDays} + paid leave {line.paidLeaveDays} + extra {line.extraDays}) · per day {money(a.perDay)}
        {line.overtimeHours ? ` · overtime ${line.overtimeHours}h` : ""}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <dl className="space-y-1">
          <dt className="font-semibold">Earnings</dt>
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-zinc-500">{k}</span>
              <span className="tabular-nums">{money(v)}</span>
            </div>
          ))}
        </dl>
        <dl className="space-y-1">
          <dt className="font-semibold">Deductions</dt>
          {deductions
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-zinc-500">{k}</span>
                <span className="tabular-nums">{money(v)}</span>
              </div>
            ))}
          <div className="flex justify-between gap-2 border-t border-zinc-200 pt-1 font-semibold dark:border-zinc-800">
            <span>Total</span>
            <span className="tabular-nums">{money(a.totalDeductions)}</span>
          </div>
        </dl>
      </div>
      <div className="flex justify-between rounded-md bg-zinc-50 px-3 py-2 font-semibold dark:bg-zinc-800">
        <span>Net payable</span>
        <span className="tabular-nums">{money(a.net)}</span>
      </div>
      {line.edits.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Changes before approval</div>
          <ul className="space-y-1 text-xs text-zinc-500">
            {line.edits.map((e, i) => (
              <li key={i}>
                {FIELD_LABEL[e.field] ?? e.field}: {e.oldValue} → {e.newValue} · {e.reason} · {e.by}, {fmtDateTime(e.at)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

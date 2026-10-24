"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, fmtDateTime, Pill, todayIst } from "../_shared/attendance-ui";

interface SalaryRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  grossMonthly: number | null;
  perDay: number | null;
  presentDays: number;
  paidLeaveDays: number;
  autoPaidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  weekendDays: number;
  holidayDays: number;
  sandwichDays: number;
  extraPayableDays: number;
  payableDays: number;
  deductionDays: number;
  deductionAmount: number | null;
  earnedAmount: number | null;
  approvedOvertimeHours: number;
  overtimePay: number;
  netPay: number | null;
}

interface Sheet {
  year: number;
  month: number;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  pendingRegularizations: number;
  monthEnded: boolean;
  rows: SalaryRow[];
}

const money = (v: number | null) => (v === null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

function previousMonth() {
  const t = todayIst();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function SalarySheetClient({ canFinalise }: { canFinalise: boolean }) {
  const [month, setMonth] = useState(previousMonth);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(() => {
    apiJson<Sheet>(`/api/v1/attendance/salary-sheet?month=${month}`)
      .then((s) => {
        setSheet(s);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  const finalise = async () => {
    setConfirm(false);
    try {
      setSheet(await apiJson<Sheet>("/api/v1/attendance/salary-sheet", { method: "POST", body: JSON.stringify({ month }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const totals = sheet?.rows.reduce(
    (t, r) => ({ net: t.net + (r.netPay ?? 0), ot: t.ot + r.overtimePay, deduction: t.deduction + (r.deductionAmount ?? 0) }),
    { net: 0, ot: 0, deduction: 0 }
  );

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance", href: "/attendance" }, { label: "Salary Sheet" }]} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Attendance Salary Sheet</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
            Per-day pay = monthly gross (fixed salary + travel + dearness allowance from the employee master) ÷ days in the month. Paid = present + paid leave + weekly offs + holidays + work on off days. Absent days and unpaid leave are deducted. Approved overtime of this month is added. A working day with no hours and no leave first uses any leftover leave quota (&quot;auto paid leave&quot;). This is a read-only sheet — no payslips are created.
          </p>
        </div>
        <div className="flex gap-2">
          <a className={buttonClasses("secondary", "xs")} href={`/api/v1/attendance/salary-sheet/export/xlsx?month=${month}`}>
            Download Excel
          </a>
          {canFinalise && sheet && !sheet.isClosed && (
            <Button size="xs" onClick={() => setConfirm(true)} disabled={!sheet.monthEnded || sheet.pendingRegularizations > 0}>
              Finalise month
            </Button>
          )}
        </div>
      </div>
      <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      <ErrorText message={error} />
      {sheet && (
        <>
          {sheet.isClosed ? (
            <p className="text-sm">
              <Pill tone="green">Finalised</Pill> by {sheet.closedBy ?? "—"} on {fmtDateTime(sheet.closedAt)} — figures are frozen.
            </p>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              <Pill tone="amber">Live preview</Pill>{" "}
              {!sheet.monthEnded && "The month hasn't ended yet. "}
              {sheet.pendingRegularizations > 0 && <span className="text-amber-700">{sheet.pendingRegularizations} regularization request(s) are pending — they must be decided before finalising. </span>}
            </p>
          )}
          <Card>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead>
                  <tr className="text-right text-xs font-medium uppercase text-zinc-500">
                    <th className="px-2 py-2 text-left">Employee</th>
                    <th className="px-2 py-2">Gross</th>
                    <th className="px-2 py-2">Present</th>
                    <th className="px-2 py-2">Paid leave</th>
                    <th className="px-2 py-2">Auto leave</th>
                    <th className="px-2 py-2">Off + hol.</th>
                    <th className="px-2 py-2">Extra</th>
                    <th className="px-2 py-2">Payable</th>
                    <th className="px-2 py-2">Absent</th>
                    <th className="px-2 py-2">Unpaid</th>
                    <th className="px-2 py-2">Deduction</th>
                    <th className="px-2 py-2">OT pay</th>
                    <th className="px-2 py-2">Net pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-right tabular-nums dark:divide-zinc-800">
                  {sheet.rows.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="px-2 py-2 text-left">
                        <div className="font-medium">{r.fullName}</div>
                        <div className="text-xs text-zinc-500">{r.employeeCode}</div>
                      </td>
                      <td className="px-2 py-2">{r.grossMonthly === null ? <span className="text-xs text-amber-700">No salary set</span> : money(r.grossMonthly)}</td>
                      <td className="px-2 py-2">{r.presentDays}</td>
                      <td className="px-2 py-2">{r.paidLeaveDays}</td>
                      <td className="px-2 py-2">{r.autoPaidLeaveDays}</td>
                      <td className="px-2 py-2">{r.weekendDays + r.holidayDays}</td>
                      <td className="px-2 py-2">{r.extraPayableDays}</td>
                      <td className="px-2 py-2 font-medium">{r.payableDays}</td>
                      <td className="px-2 py-2 text-red-600">
                        {r.absentDays}
                        {r.sandwichDays > 0 && <div className="text-xs">incl. {r.sandwichDays} sandwich</div>}
                      </td>
                      <td className="px-2 py-2">{r.unpaidLeaveDays}</td>
                      <td className="px-2 py-2">{money(r.deductionAmount)}</td>
                      <td className="px-2 py-2">
                        {money(r.overtimePay)}
                        {r.approvedOvertimeHours > 0 && <div className="text-xs text-zinc-500">{r.approvedOvertimeHours} h</div>}
                      </td>
                      <td className="px-2 py-2 font-semibold">{money(r.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr className="text-right font-semibold">
                      <td className="px-2 py-2 text-left">Total</td>
                      <td colSpan={9} />
                      <td className="px-2 py-2">{money(Math.round(totals.deduction * 100) / 100)}</td>
                      <td className="px-2 py-2">{money(Math.round(totals.ot * 100) / 100)}</td>
                      <td className="px-2 py-2">{money(Math.round(totals.net * 100) / 100)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </>
      )}
      <ConfirmModal
        open={confirm}
        title={`Finalise ${month}?`}
        message="Leftover leave quota will be used for zero-hour working days (recorded as auto leave), and the sheet will be frozen. This can't be undone."
        confirmLabel="Finalise"
        onConfirm={finalise}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

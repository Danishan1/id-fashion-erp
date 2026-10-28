"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, fmtHours } from "../../attendance/_shared/attendance-ui";
import { previousMonthKey } from "./salary-attendance-ui";

interface Row {
  employee: { id: string; employeeCode: string; fullName: string };
  workingDays: number;
  workedDays: number;
  adjustedHours: number;
  expectedHours: number;
  attendancePercent: number;
  hoursPercent: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  adjustedDays: number;
}

function Bar({ percent }: { percent: number }) {
  const tone = percent >= 90 ? "bg-emerald-500" : percent >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <span className="text-xs tabular-nums">{percent}%</span>
    </div>
  );
}

/** Salary Management → Manage Attendance (slice 2): every employee's month at a glance. */
export function SalaryAttendanceListClient() {
  const [month, setMonth] = useState(previousMonthKey);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let live = true;
    apiJson<Row[]>(`/api/v1/salary/attendance?month=${month}`)
      .then((d) => {
        if (!live) return;
        setRows(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [month]);

  const term = search.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => !term || r.employee.fullName.toLowerCase().includes(term) || r.employee.employeeCode.toLowerCase().includes(term));

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Manage Attendance" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Manage Attendance</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Review each employee&apos;s month before generating salary. Adjustments here count only for salary — the real punches are never changed.
        </p>
      </div>
      <Card
        title={rows ? `${rows.length} employees` : "Employees"}
        actions={
          <div className="flex flex-wrap gap-2">
            <input type="month" className={`${textInputClass()} w-44`} value={month} onChange={(e) => {
                if (!e.target.value) return;
                setRows(null);
                setMonth(e.target.value);
              }} />
            <input className={`${textInputClass()} w-56`} placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        }
      >
        <ErrorText message={error} />
        {!rows && !error && <p className="text-sm text-zinc-500">Loading…</p>}
        {rows && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Worked days</th>
                  <th className="px-3 py-2">Attendance</th>
                  <th className="px-3 py-2">Hours</th>
                  <th className="px-3 py-2 text-right">Present / Paid leave / Unpaid / Absent</th>
                  <th className="px-3 py-2 text-right">Adjusted days</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.employee.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.employee.fullName}</div>
                      <div className="text-xs text-zinc-500">{r.employee.employeeCode}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.workedDays} / {r.workingDays}
                    </td>
                    <td className="px-3 py-2">
                      <Bar percent={r.attendancePercent} />
                    </td>
                    <td className="px-3 py-2">
                      <Bar percent={r.hoursPercent} />
                      <div className="text-xs text-zinc-500">
                        {fmtHours(r.adjustedHours)} / {fmtHours(r.expectedHours)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.presentDays} / {r.paidLeaveDays} / {r.unpaidLeaveDays} / {r.absentDays}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.adjustedDays || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/salary/attendance/${r.employee.id}?month=${month}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                      {rows.length === 0 ? "No active employees." : "No employees match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { buttonClasses } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, fmtHours, fmtTime, todayIst } from "../_shared/attendance-ui";
import { DAY_CODE_STYLES, DayCodeLegend, type MonthSummary } from "../_shared/day-codes";

interface TeamMonth {
  year: number;
  month: number;
  dateKeys: string[];
  employees: {
    employee: { id: string; employeeCode: string; fullName: string };
    days: { dateKey: string; code: string; workedHours: number; isOutside: boolean; isLate: boolean | null; firstIn: string | null; lastOut: string | null; holidayName: string | null; leaveLabel: string | null }[];
    summary: MonthSummary;
  }[];
}

export function MonthlyRecordsClient({ canExport }: { canExport: boolean }) {
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<TeamMonth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const qs = new URLSearchParams({ month });
    if (query) qs.set("search", query);
    apiJson<TeamMonth>(`/api/v1/attendance/team-month?${qs}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month, query]);

  const exportQs = new URLSearchParams({ month, ...(query ? { search: query } : {}) });

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance", href: "/attendance" }, { label: "Monthly Records" }]} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Monthly Attendance Records</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">One row per employee, one column per day. Hover a cell for times and hours.</p>
        </div>
        {canExport && (
          <a className={buttonClasses("secondary", "xs")} href={`/api/v1/attendance/team-month/export/xlsx?${exportQs}`}>
            Download Excel
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <input placeholder="Search employee…" className={`${textInputClass()} max-w-xs`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorText message={error} />
      <DayCodeLegend />
      {data && (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0.5 text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left dark:bg-zinc-900">Employee</th>
                  {data.dateKeys.map((k) => (
                    <th key={k} className="w-7 px-0.5 py-1 text-center font-medium">
                      {Number(k.slice(8))}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right">P</th>
                  <th className="px-2 py-1 text-right">L</th>
                  <th className="px-2 py-1 text-right">A</th>
                  <th className="px-2 py-1 text-right">Late</th>
                  <th className="px-2 py-1 text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.employee.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1 dark:bg-zinc-900">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{e.employee.fullName}</div>
                      <div className="text-zinc-500">{e.employee.employeeCode}</div>
                    </td>
                    {e.days.map((d) => {
                      const s = DAY_CODE_STYLES[d.code] ?? DAY_CODE_STYLES["-"];
                      return (
                        <td
                          key={d.dateKey}
                          title={[d.dateKey, s.label, d.firstIn ? `${fmtTime(d.firstIn)}–${d.lastOut ? fmtTime(d.lastOut) : "…"}` : null, d.workedHours ? fmtHours(d.workedHours) : null, d.isLate ? "Late" : null, d.isOutside ? "Outside punch" : null, d.holidayName, d.leaveLabel].filter(Boolean).join(" · ")}
                          className={`h-7 w-7 rounded text-center font-semibold ${s.cell} ${d.isOutside ? "ring-2 ring-violet-500" : ""}`}
                        >
                          {d.code === "-" ? "" : d.code}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right tabular-nums">{e.summary.presentDays}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{e.summary.paidLeaveDays + e.summary.unpaidLeaveDays}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-red-600">{e.summary.absentDays}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{e.summary.lateDays}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtHours(e.summary.totalHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

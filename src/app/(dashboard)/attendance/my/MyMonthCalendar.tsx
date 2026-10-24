"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, fmtHours, fmtTime, todayIst } from "../_shared/attendance-ui";
import { DAY_CODE_STYLES, DayCodeLegend, type MonthDay, type MonthSummary } from "../_shared/day-codes";

interface MonthResult {
  year: number;
  month: number;
  days: MonthDay[];
  summary: MonthSummary;
}

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MyMonthCalendar() {
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [data, setData] = useState<MonthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<MonthResult>(`/api/v1/attendance/me/month?month=${month}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month]);

  const lead = data ? (new Date(`${data.days[0]?.dateKey}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <ErrorText message={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Present days", data.summary.presentDays],
              ["Paid leave", data.summary.paidLeaveDays],
              ["Unpaid leave", data.summary.unpaidLeaveDays],
              ["Absent", data.summary.absentDays],
              ["Weekly offs", data.summary.weekendDays],
              ["Holidays", data.summary.holidayDays],
              ["Hours worked", fmtHours(data.summary.totalHours)],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</div>
              </div>
            ))}
          </div>
          <Card>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-zinc-500">
              {WEEK_HEADERS.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: lead }, (_, i) => (
                <div key={`lead-${i}`} />
              ))}
              {data.days.map((d) => {
                const style = DAY_CODE_STYLES[d.code] ?? DAY_CODE_STYLES["-"];
                return (
                  <div
                    key={d.dateKey}
                    title={[d.bandLabel, d.holidayName, d.leaveLabel && `Leave: ${d.leaveLabel}`, d.isLate ? "Late" : null, d.isOutside ? "Outside punch" : null].filter(Boolean).join(" · ")}
                    className={`min-h-[4.5rem] rounded-md p-1.5 text-left text-xs ${style.cell} ${d.isOutside ? "ring-2 ring-violet-500" : ""}`}
                  >
                    <div className="flex justify-between font-semibold">
                      <span>{Number(d.dateKey.slice(8))}</span>
                      <span>{d.code === "-" ? "" : d.code}</span>
                    </div>
                    {d.firstIn && (
                      <div className="mt-1 tabular-nums">
                        {fmtTime(d.firstIn)}–{d.lastOut ? fmtTime(d.lastOut) : "…"}
                      </div>
                    )}
                    {d.workedHours > 0 && <div className="tabular-nums">{fmtHours(d.workedHours)}</div>}
                    {d.isLate && <div className="font-medium text-red-700 dark:text-red-300">Late</div>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3">
              <DayCodeLegend />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

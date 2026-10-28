"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { buttonClasses } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, fmtDateTime } from "../../attendance/_shared/attendance-ui";

interface HistoryLine {
  id: string;
  employeeCode: string;
  employeeName: string;
  paidDays: number;
  calendarDays: number;
  gross: number;
  deductions: number;
  arrears: number;
  net: number;
}

interface HistoryRun {
  id: string;
  year: number;
  month: number;
  finalisedAt: string | null;
  totalNet: number;
  lines: HistoryLine[];
}

const money = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Salary Management → Salary History (slice 4): finalised months only, read-only. */
export function SalaryHistoryClient({ canExport }: { canExport: boolean }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [data, setData] = useState<{ canSeeAll: boolean; runs: HistoryRun[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let live = true;
    apiJson<{ canSeeAll: boolean; runs: HistoryRun[] }>(`/api/v1/salary/history?year=${year}`)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setOpen(d.runs[0]?.id ?? null);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [year]);

  const term = search.trim().toLowerCase();

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Salary History" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Salary History</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {data && !data.canSeeAll ? "Your salary slips for finalised months." : "Finalised salaries — view and download salary slips."}
          </p>
        </div>
        <div className="flex gap-2">
          {data?.canSeeAll && <input className={`${textInputClass()} w-56`} placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} />}
          <select
            className={`${textInputClass()} w-28`}
            value={year}
            onChange={(e) => {
              setData(null);
              setYear(e.target.value);
            }}
          >
            {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorText message={error} />
      {!data && !error && <p className="text-sm text-zinc-500">Loading…</p>}
      {data && data.runs.length === 0 && <p className="text-sm text-zinc-500">No finalised salary in {year}.</p>}

      {data?.runs.map((run) => {
        const lines = run.lines.filter((l) => !term || l.employeeName.toLowerCase().includes(term) || l.employeeCode.toLowerCase().includes(term));
        const expanded = open === run.id;
        return (
          <Card
            key={run.id}
            title={
              <button type="button" className="text-left" onClick={() => setOpen(expanded ? null : run.id)}>
                {expanded ? "▾" : "▸"} {monthName(run.year, run.month)}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {run.lines.length} employee(s) · net {money(run.totalNet)}
                  {run.finalisedAt && ` · finalised ${fmtDateTime(run.finalisedAt)}`}
                </span>
              </button>
            }
            actions={
              canExport && data.canSeeAll ? (
                <a href={`/api/v1/salary/history/runs/${run.id}/export`} className={buttonClasses("secondary", "xs")}>
                  Excel report
                </a>
              ) : undefined
            }
          >
            {expanded && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                      <th className="px-2 py-2">Employee</th>
                      <th className="px-2 py-2 text-right">Paid days</th>
                      <th className="px-2 py-2 text-right">Gross</th>
                      <th className="px-2 py-2 text-right">Deductions</th>
                      <th className="px-2 py-2 text-right">Arrears</th>
                      <th className="px-2 py-2 text-right">Net</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-2">
                          {l.employeeName} <span className="text-xs text-zinc-500">{l.employeeCode}</span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {l.paidDays} / {l.calendarDays}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(l.gross)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{money(l.deductions)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{l.arrears ? money(l.arrears) : "—"}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(l.net)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          <a href={`/api/v1/salary/history/slips/${l.id}/pdf?disposition=inline`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-500">
                            View slip
                          </a>
                          <a href={`/api/v1/salary/history/slips/${l.id}/pdf`} className="ml-3 text-indigo-600 hover:text-indigo-500">
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-4 text-center text-zinc-500">
                          No employees match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface CarryForwardRow {
  id: string;
  fromYear: number;
  toYear: number;
  carriedDays: string;
  employee: { fullName: string; employeeCode: string };
  leaveType: { name: string };
}

interface CarryForwardResult {
  fromYear: number;
  toYear: number;
  employeesProcessed: number;
  carryForwardsCreated: number;
  totalDaysCarried: number;
}

export default function LeaveTypesPage() {
  const [fromYear, setFromYear] = useState(String(new Date().getFullYear() - 1));
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CarryForwardResult | null>(null);
  const [records, setRecords] = useState<CarryForwardRow[] | null>(null);

  const runCarryForward = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    setRecords(null);

    const res = await fetch("/api/v1/leave-requests/carry-forward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromYear: Number(fromYear) }),
    });
    const body = await res.json();

    if (!res.ok) {
      setError(body?.error?.message ?? "Failed to run carry-forward.");
      setIsRunning(false);
      return;
    }

    setResult(body.data);
    const listRes = await fetch(`/api/v1/leave-requests/carry-forward?toYear=${body.data.toYear}`);
    const listBody = await listRes.json();
    if (listRes.ok) setRecords(listBody.data ?? []);
    setIsRunning(false);
  };

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leave Types" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leave Types</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Annual leave quota per type — used to compute each employee&apos;s remaining balance when approving a request.
        </p>
      </div>

      <SimpleLookupManager
        fetchUrl="/api/v1/leave-types"
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "annualDays", label: "Annual Days", type: "number", required: true },
        ]}
      />

      <div className="max-w-xl border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Leave Carry-Forward</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Carries each active employee&apos;s unused balance from one year into the next, per leave type. This has no
          scheduled/automatic trigger — run it manually once a year (typically after the last day of the outgoing
          year). Safe to run more than once: an employee/leave-type pair already carried into the target year is
          skipped, not double-credited.
        </p>

        <div className="mt-3 flex items-end gap-3">
          <div className="w-32">
            <FormField label="From Year" htmlFor="fromYear">
              <input
                id="fromYear"
                type="number"
                value={fromYear}
                onChange={(e) => setFromYear(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          </div>
          <button
            type="button"
            onClick={runCarryForward}
            disabled={isRunning || !fromYear}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isRunning ? "Running…" : "Run Carry-Forward"}
          </button>
        </div>

        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {result && (
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-200">
            Processed {result.employeesProcessed} employee(s) for {result.fromYear} → {result.toYear}: created{" "}
            {result.carryForwardsCreated} carry-forward record(s) totalling {result.totalDaysCarried} day(s).
          </p>
        )}

        {records && records.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Leave Type</th>
                  <th className="px-4 py-2 font-medium">Carried Days</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                      {r.employee.fullName} ({r.employee.employeeCode})
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{r.leaveType.name}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{r.carriedDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

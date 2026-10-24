"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { apiJson, Card, ErrorText, fmtDbDate, fmtHours, Pill, todayIst } from "../_shared/attendance-ui";

interface OvertimeRow {
  id: string;
  attendanceDate: string;
  hours: number;
  workedHours: number;
  shiftHours: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  amount: number;
}

export function OvertimeStatusPill({ status }: { status: string }) {
  return status === "APPROVED" ? <Pill tone="green">Approved</Pill> : status === "REJECTED" ? <Pill tone="red">Rejected</Pill> : <Pill tone="amber">Pending</Pill>;
}

export function MyOvertimeList() {
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<OvertimeRow[]>(`/api/v1/attendance/overtime?mine=true&month=${month}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [month]);

  const total = rows.filter((r) => r.status === "APPROVED").reduce((s, r) => s + r.hours, 0);

  return (
    <Card title="My overtime" actions={<input type="month" className={`${textInputClass()} max-w-[12rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}>
      <ErrorText message={error} />
      <p className="mb-2 text-xs text-zinc-500">Overtime = hours worked beyond your shift, calculated when you punch out. Approved overtime this month: {fmtHours(total)}.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No overtime this month.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-zinc-500">
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Worked</th>
              <th className="py-2 pr-3">Shift</th>
              <th className="py-2 pr-3">Overtime</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3">{fmtDbDate(r.attendanceDate)}</td>
                <td className="py-2 pr-3 tabular-nums">{fmtHours(r.workedHours)}</td>
                <td className="py-2 pr-3 tabular-nums">{fmtHours(r.shiftHours)}</td>
                <td className="py-2 pr-3 tabular-nums font-medium">{fmtHours(r.hours)}</td>
                <td className="py-2 pr-3">
                  <OvertimeStatusPill status={r.status} />
                  {r.rejectionReason && <div className="text-xs text-zinc-500">{r.rejectionReason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

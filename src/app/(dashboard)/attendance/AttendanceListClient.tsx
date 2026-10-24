"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { apiJson, Card, ErrorText, fmtHours, fmtTime, Pill, todayIst } from "./_shared/attendance-ui";
import { useScopedEmployees } from "./_shared/useScopedEmployees";

type Status = "PRESENT" | "OUTSIDE" | "HALF_DAY" | "ON_LEAVE" | "ABSENT" | "NOT_PUNCHED" | "WEEKLY_OFF" | "HOLIDAY" | "NOT_JOINED";

interface TeamDay {
  dateKey: string;
  isToday: boolean;
  cards: { total: number; present: number; outside: number; halfDay: number; onLeave: number; absent: number; notPunched: number; off: number; late: number };
  rows: {
    employee: { id: string; employeeCode: string; fullName: string; shift: { name: string; startTime: string; endTime: string } | null };
    status: Status;
    day: { firstIn: string | null; lastOut: string | null; workedHours: number; isLate: boolean | null; hasOpenSession: boolean; sessionCount: number; leaveLabel: string | null; holidayName: string | null; bandLabel: string | null };
  }[];
}

const STATUS_PILL: Record<Status, { label: string; tone: "green" | "red" | "amber" | "blue" | "purple" | "zinc" }> = {
  PRESENT: { label: "Present", tone: "green" },
  OUTSIDE: { label: "Outside", tone: "purple" },
  HALF_DAY: { label: "Half / short day", tone: "amber" },
  ON_LEAVE: { label: "On leave", tone: "blue" },
  ABSENT: { label: "Absent", tone: "red" },
  NOT_PUNCHED: { label: "Not punched", tone: "zinc" },
  WEEKLY_OFF: { label: "Weekly off", tone: "zinc" },
  HOLIDAY: { label: "Holiday", tone: "zinc" },
  NOT_JOINED: { label: "Not joined", tone: "zinc" },
};

export function AttendanceListClient({ canRecord }: { canRecord: boolean }) {
  const [date, setDate] = useState(todayIst());
  const [data, setData] = useState<TeamDay | null>(null);
  const [filter, setFilter] = useState<Status | "ALL" | "LATE">("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(() => {
    apiJson<TeamDay>(`/api/v1/attendance/team-day?date=${date}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [date]);
  useEffect(() => {
    load();
  }, [load]);

  const rows = (data?.rows ?? []).filter(
    (r) =>
      (filter === "ALL" || (filter === "LATE" ? r.day.isLate === true : r.status === filter)) &&
      (!search || r.employee.fullName.toLowerCase().includes(search.toLowerCase()) || r.employee.employeeCode.toLowerCase().includes(search.toLowerCase()))
  );

  const card = (label: string, value: number, key: Status | "ALL" | "LATE", tone: string) => (
    <button
      type="button"
      onClick={() => setFilter(filter === key ? "ALL" : key)}
      className={`rounded-lg border p-3 text-left transition-colors ${filter === key ? "border-indigo-500 ring-1 ring-indigo-500" : "border-zinc-200 dark:border-zinc-800"} bg-white dark:bg-zinc-900`}
    >
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Team Attendance" }]} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Team Attendance</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Who is in, outside, on leave or absent. Late is checked against each employee&apos;s own shift and grace time.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/attendance/my" className="font-medium text-indigo-600 hover:text-indigo-500">
            My Attendance
          </Link>
          <Link href="/attendance/records" className="font-medium text-indigo-600 hover:text-indigo-500">
            Monthly Records
          </Link>
          {canRecord && (
            <Button size="xs" onClick={() => setRecording(true)}>
              Record Attendance
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="date" className={`${textInputClass()} max-w-[12rem]`} value={date} max={todayIst()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <input placeholder="Search employee…" className={`${textInputClass()} max-w-xs`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorText message={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {card("Total", data.cards.total, "ALL", "text-zinc-900 dark:text-zinc-50")}
            {card("Present", data.cards.present, "PRESENT", "text-emerald-600")}
            {card("Outside", data.cards.outside, "OUTSIDE", "text-violet-600")}
            {card("Half / short", data.cards.halfDay, "HALF_DAY", "text-amber-600")}
            {card("On leave", data.cards.onLeave, "ON_LEAVE", "text-sky-600")}
            {card(data.isToday ? "Not punched" : "Absent", data.isToday ? data.cards.notPunched : data.cards.absent, data.isToday ? "NOT_PUNCHED" : "ABSENT", "text-red-600")}
            {card("Off / holiday", data.cards.off, "WEEKLY_OFF", "text-zinc-500")}
            {card("Late", data.cards.late, "LATE", "text-orange-600")}
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase text-zinc-500">
                    <th className="px-2 py-2">Employee</th>
                    <th className="px-2 py-2">Shift</th>
                    <th className="px-2 py-2">First in</th>
                    <th className="px-2 py-2">Last out</th>
                    <th className="px-2 py-2">Hours</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-zinc-500">
                        No employees.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.employee.id}>
                      <td className="px-2 py-2">
                        <div className="font-medium">{r.employee.fullName}</div>
                        <div className="text-xs text-zinc-500">{r.employee.employeeCode}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">{r.employee.shift ? `${r.employee.shift.startTime}–${r.employee.shift.endTime}` : <span className="text-zinc-400">No shift</span>}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {fmtTime(r.day.firstIn)} {r.day.isLate && <Pill tone="red">Late</Pill>}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{r.day.hasOpenSession ? <span className="text-emerald-700">In now</span> : fmtTime(r.day.lastOut)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.day.workedHours > 0 ? fmtHours(r.day.workedHours) : "—"}</td>
                      <td className="px-2 py-2">
                        <Pill tone={STATUS_PILL[r.status].tone}>{STATUS_PILL[r.status].label}</Pill>
                        {r.day.leaveLabel && <div className="text-xs text-zinc-500">{r.day.leaveLabel}</div>}
                        {r.day.holidayName && <div className="text-xs text-zinc-500">{r.day.holidayName}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <Modal open={recording} onClose={() => setRecording(false)} title="Record attendance (manual)">
        {recording && (
          <RecordForm
            defaultDate={date}
            onClose={() => setRecording(false)}
            onDone={() => {
              setRecording(false);
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function RecordForm({ defaultDate, onClose, onDone }: { defaultDate: string; onClose: () => void; onDone: () => void }) {
  const { options } = useScopedEmployees();
  const [employeeId, setEmployeeId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(defaultDate);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await apiJson("/api/v1/attendance/sessions", { method: "POST", body: JSON.stringify({ employeeId, attendanceDate, checkIn, checkOut: checkOut || null, remarks }) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorText message={error} />
      <FormField label="Employee" htmlFor="rec-emp" required>
        <SearchableSelect id="rec-emp" options={options} value={employeeId} onChange={setEmployeeId} placeholder="Select employee…" />
      </FormField>
      <FormField label="Date" htmlFor="rec-date" required>
        <input id="rec-date" type="date" max={todayIst()} className={textInputClass()} value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Check-in" htmlFor="rec-in" required>
          <input id="rec-in" type="time" className={textInputClass()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </FormField>
        <FormField label="Check-out" htmlFor="rec-out">
          <input id="rec-out" type="time" className={textInputClass()} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Remarks" htmlFor="rec-remarks">
        <input id="rec-remarks" className={textInputClass()} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </FormField>
      <p className="text-xs text-zinc-500">Adds a session marked &quot;Added by HR&quot;. It can&apos;t overlap the employee&apos;s other punches.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!employeeId || !attendanceDate || !checkIn}>
          Save
        </Button>
      </div>
    </div>
  );
}

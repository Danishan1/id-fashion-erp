"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface Option {
  id: string;
  employeeCode?: string;
  fullName?: string;
}

interface AttendanceRow {
  id: string;
  attendanceDate: string;
  punchIn: string | null;
  punchOut: string | null;
  isLate: boolean | null;
  remarks: string | null;
  employee: { fullName: string; employeeCode: string };
}

export default function AttendancePage() {
  const [showModal, setShowModal] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState("");
  const [punchIn, setPunchIn] = useState("");
  const [punchOut, setPunchOut] = useState("");
  const [remarks, setRemarks] = useState("");
  const [employees, setEmployees] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/v1/employees?pageSize=500")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setEmployees(body.data ?? []))
      .catch(() => setEmployees([]));
  }, []);

  const submit = async () => {
    setError(null);
    const res = await fetch("/api/v1/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        attendanceDate,
        punchIn: punchIn ? `${attendanceDate}T${punchIn}:00` : undefined,
        punchOut: punchOut ? `${attendanceDate}T${punchOut}:00` : undefined,
        remarks: remarks || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to record attendance.");
      return;
    }
    setShowModal(false);
    setEmployeeId("");
    setAttendanceDate("");
    setPunchIn("");
    setPunchOut("");
    setRemarks("");
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Attendance</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Daily punch in/out per employee. Late is computed against each employee&apos;s own assigned shift, not one
            fixed company-wide cutoff.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Record Attendance
        </button>
      </div>

      <DataTable<AttendanceRow>
        key={refreshKey}
        fetchUrl="/api/v1/attendance"
        searchPlaceholder="Search by employee name…"
        columns={[
          { key: "employee", header: "Employee", render: (row) => `${row.employee.fullName} (${row.employee.employeeCode})` },
          { key: "attendanceDate", header: "Date", render: (row) => new Date(row.attendanceDate).toLocaleDateString() },
          { key: "punchIn", header: "Punch In", render: (row) => (row.punchIn ? new Date(row.punchIn).toLocaleTimeString() : "—") },
          { key: "punchOut", header: "Punch Out", render: (row) => (row.punchOut ? new Date(row.punchOut).toLocaleTimeString() : "—") },
          {
            key: "isLate",
            header: "Status",
            render: (row) =>
              !row.punchIn ? (
                <span className="text-red-600 dark:text-red-400">Absent</span>
              ) : row.isLate === true ? (
                <span className="text-amber-600 dark:text-amber-400">Late</span>
              ) : row.isLate === false ? (
                <span className="text-green-600 dark:text-green-400">On Time</span>
              ) : (
                <span className="text-zinc-400" title="This employee has no shift assigned, so lateness can't be determined.">
                  No Shift
                </span>
              ),
          },
        ]}
      />

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Attendance">
        <div className="space-y-3">
          <FormField label="Employee" htmlFor="employeeId" required>
            <select id="employeeId" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} ({e.employeeCode})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date" htmlFor="attendanceDate" required>
            <input id="attendanceDate" type="date" required value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Punch In" htmlFor="punchIn">
              <input id="punchIn" type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Punch Out" htmlFor="punchOut">
              <input id="punchOut" type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} className={textInputClass()} />
            </FormField>
          </div>
          <FormField label="Remarks" htmlFor="remarks">
            <input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!employeeId || !attendanceDate}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

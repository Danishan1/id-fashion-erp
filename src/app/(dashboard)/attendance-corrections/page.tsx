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

interface AttendanceCorrectionRow {
  id: string;
  attendanceDate: string;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  employee: { fullName: string; employeeCode: string };
}

export default function AttendanceCorrectionsPage() {
  const [showModal, setShowModal] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [attendanceDate, setAttendanceDate] = useState("");
  const [punchIn, setPunchIn] = useState("");
  const [punchOut, setPunchOut] = useState("");
  const [reason, setReason] = useState("");
  const [employees, setEmployees] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [rejectTarget, setRejectTarget] = useState<AttendanceCorrectionRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveError, setApproveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/employees?pageSize=500")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setEmployees(body.data ?? []))
      .catch(() => setEmployees([]));
  }, []);

  const submit = async () => {
    setError(null);
    const res = await fetch("/api/v1/attendance-corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        attendanceDate,
        requestedPunchIn: punchIn ? `${attendanceDate}T${punchIn}:00` : undefined,
        requestedPunchOut: punchOut ? `${attendanceDate}T${punchOut}:00` : undefined,
        reason,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to submit this correction request.");
      return;
    }
    setShowModal(false);
    setEmployeeId("");
    setAttendanceDate("");
    setPunchIn("");
    setPunchOut("");
    setReason("");
    setRefreshKey((k) => k + 1);
  };

  const approve = async (id: string) => {
    setApproveError(null);
    const res = await fetch(`/api/v1/attendance-corrections/${id}/approve`, { method: "POST" });
    if (res.ok) setRefreshKey((k) => k + 1);
    else {
      const body = await res.json().catch(() => null);
      setApproveError(body?.error?.message ?? "Failed to approve.");
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const res = await fetch(`/api/v1/attendance-corrections/${rejectTarget.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason }),
    });
    if (res.ok) {
      setRejectTarget(null);
      setRejectReason("");
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Attendance Corrections" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Attendance Corrections</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Request a punch-time correction for a missed or wrong entry. Approving applies the corrected time(s)
            directly onto that day&apos;s attendance record.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New Correction Request
        </button>
      </div>

      {approveError && <p className="text-sm text-red-600 dark:text-red-400">{approveError}</p>}

      <DataTable<AttendanceCorrectionRow>
        key={refreshKey}
        fetchUrl="/api/v1/attendance-corrections"
        searchPlaceholder="Search by employee name…"
        columns={[
          { key: "employee", header: "Employee", render: (row) => `${row.employee.fullName} (${row.employee.employeeCode})` },
          { key: "attendanceDate", header: "Date", render: (row) => new Date(row.attendanceDate).toLocaleDateString() },
          { key: "requestedPunchIn", header: "Requested In", render: (row) => (row.requestedPunchIn ? new Date(row.requestedPunchIn).toLocaleTimeString() : "—") },
          { key: "requestedPunchOut", header: "Requested Out", render: (row) => (row.requestedPunchOut ? new Date(row.requestedPunchOut).toLocaleTimeString() : "—") },
          { key: "reason", header: "Reason", render: (row) => row.reason },
          { key: "status", header: "Status", render: (row) => row.status },
          {
            key: "actions",
            header: "Actions",
            render: (row) =>
              row.status === "PENDING" ? (
                <div className="flex gap-3">
                  <button type="button" onClick={() => approve(row.id)} className="text-xs font-medium text-green-600 hover:underline">
                    Approve
                  </button>
                  <button type="button" onClick={() => setRejectTarget(row)} className="text-xs font-medium text-red-600 hover:underline">
                    Reject
                  </button>
                </div>
              ) : row.status === "REJECTED" && row.rejectionReason ? (
                <span className="text-xs text-zinc-500">{row.rejectionReason}</span>
              ) : (
                "—"
              ),
          },
        ]}
      />

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Correction Request">
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
            <FormField label="Corrected Punch In" htmlFor="punchIn">
              <input id="punchIn" type="time" value={punchIn} onChange={(e) => setPunchIn(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Corrected Punch Out" htmlFor="punchOut">
              <input id="punchOut" type="time" value={punchOut} onChange={(e) => setPunchOut(e.target.value)} className={textInputClass()} />
            </FormField>
          </div>
          <FormField label="Reason" htmlFor="reason" required>
            <textarea id="reason" required value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} rows={2} />
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
              disabled={!employeeId || !attendanceDate || !reason || (!punchIn && !punchOut)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Submit
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Correction Request">
        <div className="space-y-3">
          <FormField label="Reason" htmlFor="rejectReason" required>
            <textarea id="rejectReason" required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className={textInputClass()} rows={3} />
          </FormField>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitReject}
              disabled={!rejectReason}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

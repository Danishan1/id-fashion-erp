"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { RowAction } from "@/components/ui/RowAction";
import { ApproveIcon, RejectIcon } from "@/components/ui/icons";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "@/lib/hr-approval-status-labels";

interface Option {
  id: string;
  employeeCode?: string;
  fullName?: string;
  name?: string;
}

interface LeaveRequestRow {
  id: string;
  startDate: string;
  endDate: string;
  status: keyof typeof STATUS_LABELS;
  reason: string | null;
  rejectionReason: string | null;
  employee: { fullName: string; employeeCode: string };
  leaveType: { name: string };
}

export function LeaveRequestsListClient() {
  const [showModal, setShowModal] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [employees, setEmployees] = useState<Option[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [rejectTarget, setRejectTarget] = useState<LeaveRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveError, setApproveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/employees?pageSize=500")
      .then((res) => res.json())
      .then((body) => setEmployees(body.data ?? []));
    fetch("/api/v1/leave-types")
      .then((res) => res.json())
      .then((body) => setLeaveTypes(body.data ?? []));
  }, []);

  const submit = async () => {
    setError(null);
    const res = await fetch("/api/v1/leave-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, leaveTypeId, startDate, endDate, reason: reason || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to submit this leave request.");
      return;
    }
    setShowModal(false);
    setEmployeeId("");
    setLeaveTypeId("");
    setStartDate("");
    setEndDate("");
    setReason("");
    setRefreshKey((k) => k + 1);
  };

  const approve = async (id: string) => {
    setApproveError(null);
    const res = await fetch(`/api/v1/leave-requests/${id}/approve`, { method: "POST" });
    if (res.ok) setRefreshKey((k) => k + 1);
    else {
      const body = await res.json().catch(() => null);
      setApproveError(body?.error?.message ?? "Failed to approve.");
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const res = await fetch(`/api/v1/leave-requests/${rejectTarget.id}/reject`, {
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
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leave Requests" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leave Requests</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Approving a request checks the employee&apos;s real remaining balance for that leave type and year — a
            request that would exceed it is blocked.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New Leave Request
        </button>
      </div>

      {approveError && <p className="text-sm text-red-600 dark:text-red-400">{approveError}</p>}

      <DataTable<LeaveRequestRow>
        key={refreshKey}
        fetchUrl="/api/v1/leave-requests"
        searchPlaceholder="Search by employee name…"
        columns={[
          { key: "employee", header: "Employee", render: (row) => `${row.employee.fullName} (${row.employee.employeeCode})` },
          { key: "leaveType", header: "Type", render: (row) => row.leaveType.name },
          {
            key: "dates",
            header: "Dates",
            render: (row) => `${new Date(row.startDate).toLocaleDateString()} – ${new Date(row.endDate).toLocaleDateString()}`,
          },
          { key: "reason", header: "Reason", render: (row) => row.reason ?? "—" },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
          {
            key: "actions",
            header: "Actions",
            render: (row) =>
              row.status === "PENDING" ? (
                <div className="flex gap-3">
                  <RowAction icon={<ApproveIcon />} label="Approve" onClick={() => approve(row.id)} variant="success" />
                  <RowAction icon={<RejectIcon />} label="Reject" onClick={() => setRejectTarget(row)} variant="danger" />
                </div>
              ) : row.status === "REJECTED" && row.rejectionReason ? (
                <span className="text-xs text-zinc-500">{row.rejectionReason}</span>
              ) : (
                "—"
              ),
          },
        ]}
      />

      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Leave Request">
        <div className="space-y-3">
          <FormField label="Employee" htmlFor="employeeId" required>
            <SearchableSelect
              id="employeeId"
              required
              value={employeeId}
              onChange={setEmployeeId}
              options={employees.map((e) => ({ id: e.id, label: e.fullName ?? "", sublabel: e.employeeCode }))}
              placeholder="Search employee…"
            />
          </FormField>
          <FormField label="Leave Type" htmlFor="leaveTypeId" required>
            <select id="leaveTypeId" required value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Date" htmlFor="startDate" required>
              <input id="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="End Date" htmlFor="endDate" required>
              <input id="endDate" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className={textInputClass()} />
            </FormField>
          </div>
          <FormField label="Reason" htmlFor="reason">
            <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} rows={2} />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!employeeId || !leaveTypeId || !startDate || !endDate}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Submit
          </button>
        </div>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Leave Request">
        <div className="space-y-3">
          <FormField label="Reason" htmlFor="rejectReason" required>
            <textarea id="rejectReason" required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className={textInputClass()} rows={3} />
          </FormField>
          <button
            type="button"
            onClick={submitReject}
            disabled={!rejectReason}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      </Modal>
    </div>
  );
}

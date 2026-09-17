"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { RowAction } from "@/components/ui/RowAction";
import { EditIcon, ApproveIcon, RejectIcon } from "@/components/ui/icons";

interface PendingEntry {
  id: string;
  completedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  remarks: string | null;
  createdAt: string;
  employee: { id: string; fullName: string; employeeCode: string };
  jobOrder: {
    id: string;
    jobNumber: string;
    productionStage: { name: string };
    lot: { lotNumber: string };
  };
}

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function ApprovalsClient() {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Bumped after every mutation to re-trigger the load effect below — see
  // MyWorkClient's identical pattern for why (react-hooks/set-state-in-effect).
  const [refreshKey, setRefreshKey] = useState(0);

  const [editTarget, setEditTarget] = useState<PendingEntry | null>(null);
  const [editCompleted, setEditCompleted] = useState("0");
  const [editRejected, setEditRejected] = useState("0");
  const [editDamaged, setEditDamaged] = useState("0");
  const [editRemarks, setEditRemarks] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [approveTarget, setApproveTarget] = useState<PendingEntry | null>(null);
  const [approveRemark, setApproveRemark] = useState("");
  const [approveError, setApproveError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<PendingEntry | null>(null);
  const [rejectRemark, setRejectRemark] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/job-order-progress-entries/pending")
      .then(async (res) => {
        if (!res.ok) {
          setLoadError(await parseErrorMessage(res, "Unable to load pending entries."));
          return;
        }
        setLoadError(null);
        const body = await res.json();
        setEntries(body.data ?? []);
      })
      .catch(() => setLoadError("Unable to load pending entries."));
  }, [refreshKey]);

  const openEdit = (entry: PendingEntry) => {
    setEditTarget(entry);
    setEditCompleted(entry.completedQuantity);
    setEditRejected(entry.rejectedQuantity);
    setEditDamaged(entry.damagedQuantity);
    setEditRemarks(entry.remarks ?? "");
    setEditError(null);
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    setIsBusy(true);
    setEditError(null);
    const res = await fetch(`/api/v1/job-order-progress-entries/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completedQuantity: Number(editCompleted),
        rejectedQuantity: Number(editRejected),
        damagedQuantity: Number(editDamaged),
        remarks: editRemarks || undefined,
      }),
    });
    if (!res.ok) {
      setEditError(await parseErrorMessage(res, "Failed to update this entry."));
      setIsBusy(false);
      return;
    }
    setIsBusy(false);
    setEditTarget(null);
    setRefreshKey((k) => k + 1);
  };

  const submitApprove = async () => {
    if (!approveTarget) return;
    setIsBusy(true);
    setApproveError(null);
    const res = await fetch(`/api/v1/job-order-progress-entries/${approveTarget.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalRemark: approveRemark || undefined }),
    });
    if (!res.ok) {
      setApproveError(await parseErrorMessage(res, "Failed to approve this entry."));
      setIsBusy(false);
      return;
    }
    setIsBusy(false);
    setApproveTarget(null);
    setApproveRemark("");
    setRefreshKey((k) => k + 1);
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!rejectRemark.trim()) {
      setRejectError("A remark is required to reject an entry.");
      return;
    }
    setIsBusy(true);
    setRejectError(null);
    const res = await fetch(`/api/v1/job-order-progress-entries/${rejectTarget.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalRemark: rejectRemark }),
    });
    if (!res.ok) {
      setRejectError(await parseErrorMessage(res, "Failed to reject this entry."));
      setIsBusy(false);
      return;
    }
    setIsBusy(false);
    setRejectTarget(null);
    setRejectRemark("");
    setRefreshKey((k) => k + 1);
  };

  const term = search.trim().toLowerCase();
  const filteredEntries = term
    ? entries.filter((e) =>
        [
          e.employee.fullName,
          e.employee.employeeCode,
          e.jobOrder.jobNumber,
          e.jobOrder.productionStage.name,
          e.jobOrder.lot.lotNumber,
          e.remarks ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
    : entries;

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Pending Approvals" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Pending Approvals</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Progress entries workers logged themselves — approve to apply the quantities to the job order, reject with a
          remark to discard, or correct the numbers first.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {loadError}
        </div>
      )}

      {!loadError && entries.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing is waiting on your review right now.</p>
      )}

      {entries.length > 0 && (
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder="Search…"
            className={`${textInputClass()} max-w-xs`}
          />
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Job Order</th>
                <th className="px-3 py-2">Completed</th>
                <th className="px-3 py-2">Rejected</th>
                <th className="px-3 py-2">Damaged</th>
                <th className="px-3 py-2">Remarks</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-zinc-400">
                    No entries match your search.
                  </td>
                </tr>
              )}
              {filteredEntries.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                    {e.employee.fullName} <span className="text-xs text-zinc-400">({e.employee.employeeCode})</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                    {e.jobOrder.productionStage.name} ({e.jobOrder.jobNumber}, Lot {e.jobOrder.lot.lotNumber})
                  </td>
                  <td className="px-3 py-2">{e.completedQuantity}</td>
                  <td className="px-3 py-2">{e.rejectedQuantity}</td>
                  <td className="px-3 py-2">{e.damagedQuantity}</td>
                  <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{e.remarks || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-3 text-xs font-medium">
                      <RowAction icon={<EditIcon />} label="Edit" onClick={() => openEdit(e)} />
                      <RowAction
                        icon={<ApproveIcon />}
                        label="Approve"
                        variant="success"
                        onClick={() => {
                          setApproveTarget(e);
                          setApproveRemark("");
                          setApproveError(null);
                        }}
                      />
                      <RowAction
                        icon={<RejectIcon />}
                        label="Reject"
                        variant="danger"
                        onClick={() => {
                          setRejectTarget(e);
                          setRejectRemark("");
                          setRejectError(null);
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Correct Entry">
        {editTarget && (
          <div className="space-y-4">
            {editError && <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>}
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Completed" htmlFor="editCompleted">
                <input
                  id="editCompleted"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={editCompleted}
                  onChange={(e) => setEditCompleted(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Rejected" htmlFor="editRejected">
                <input
                  id="editRejected"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={editRejected}
                  onChange={(e) => setEditRejected(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Damaged" htmlFor="editDamaged">
                <input
                  id="editDamaged"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={editDamaged}
                  onChange={(e) => setEditDamaged(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
            </div>
            <FormField label="Remarks" htmlFor="editRemarks">
              <input id="editRemarks" value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={isBusy}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Save Correction"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!approveTarget} onClose={() => setApproveTarget(null)} title="Approve Entry">
        {approveTarget && (
          <div className="space-y-4">
            {approveError && <p className="text-sm text-red-600 dark:text-red-400">{approveError}</p>}
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              This will apply {approveTarget.completedQuantity} completed / {approveTarget.rejectedQuantity} rejected /{" "}
              {approveTarget.damagedQuantity} damaged to job order {approveTarget.jobOrder.jobNumber}.
            </p>
            <FormField label="Remark (optional)" htmlFor="approveRemark">
              <input id="approveRemark" value={approveRemark} onChange={(e) => setApproveRemark(e.target.value)} className={textInputClass()} />
            </FormField>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitApprove}
                disabled={isBusy}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {isBusy ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Entry">
        {rejectTarget && (
          <div className="space-y-4">
            {rejectError && <p className="text-sm text-red-600 dark:text-red-400">{rejectError}</p>}
            <FormField label="Remark" htmlFor="rejectRemark" required>
              <input id="rejectRemark" value={rejectRemark} onChange={(e) => setRejectRemark(e.target.value)} className={textInputClass()} />
            </FormField>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReject}
                disabled={isBusy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {isBusy ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

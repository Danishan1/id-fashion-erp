"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";

interface JobOrderRow {
  id: string;
  jobNumber: string;
  plannedQuantity: string;
  completedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  status: string;
  productionStage: { id: string; name: string; code: string };
  lot: { id: string; lotNumber: string };
}

interface AssignmentRow {
  id: string;
  assignedQuantity: string;
  status: string;
  jobOrder: JobOrderRow;
}

type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

interface SubmittedEntry {
  id: string;
  completedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  remarks: string | null;
  approvalStatus: ApprovalStatus;
  approvalRemark: string | null;
  createdAt: string;
  jobOrder: { jobNumber: string; productionStage: { name: string } };
}

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const APPROVAL_BADGE_CLASS: Record<ApprovalStatus, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function remainingOf(jo: JobOrderRow) {
  return Number(jo.plannedQuantity) - Number(jo.completedQuantity) - Number(jo.rejectedQuantity) - Number(jo.damagedQuantity);
}

export function MyWorkClient() {
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [entries, setEntries] = useState<SubmittedEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped after every mutation to re-trigger the load effect below — kept
  // out of the effect body itself (react-hooks/set-state-in-effect: a
  // setState-triggering fetch must live inside the effect's own .then()
  // chain, not be invoked as a plain statement from it).
  const [refreshKey, setRefreshKey] = useState(0);

  const [progressTarget, setProgressTarget] = useState<JobOrderRow | null>(null);
  const [completed, setCompleted] = useState("0");
  const [rejected, setRejected] = useState("0");
  const [damaged, setDamaged] = useState("0");
  const [remarks, setRemarks] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/job-orders/my-assignments")
      .then(async (res) => {
        if (!res.ok) {
          setLoadError(await parseErrorMessage(res, "Unable to load your assigned work."));
          setAssignments([]);
          setEntries([]);
          return;
        }
        setLoadError(null);
        const body = await res.json();
        setAssignments(body.data ?? []);

        const entriesRes = await fetch("/api/v1/job-order-progress-entries/mine");
        if (entriesRes.ok) {
          const entriesBody = await entriesRes.json();
          setEntries(entriesBody.data ?? []);
        }
      })
      .catch(() => setLoadError("Unable to load your assigned work."));
  }, [refreshKey]);

  const openProgressModal = (jo: JobOrderRow) => {
    setProgressTarget(jo);
    setCompleted("0");
    setRejected("0");
    setDamaged("0");
    setRemarks("");
    setFormError(null);
  };

  const submitProgress = async () => {
    if (!progressTarget) return;
    setIsBusy(true);
    setFormError(null);
    const res = await fetch(`/api/v1/job-orders/${progressTarget.id}/self-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completedQuantity: Number(completed),
        rejectedQuantity: Number(rejected),
        damagedQuantity: Number(damaged),
        remarks: remarks || undefined,
      }),
    });
    if (!res.ok) {
      setFormError(await parseErrorMessage(res, "Failed to submit your progress."));
      setIsBusy(false);
      return;
    }
    setIsBusy(false);
    setProgressTarget(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Work" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">My Work</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Log your own progress on jobs assigned to you — a Supervisor reviews and approves each entry before it counts
          toward the job order.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {loadError}
        </div>
      )}

      {!loadError && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Assigned to Me</h2>
          {assignments !== null && assignments.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No active job orders are assigned to you right now.</p>
          )}
          {(assignments ?? []).map((a) => {
            const jo = a.jobOrder;
            const remaining = remainingOf(jo);
            const canLog = remaining > 0 && jo.status !== "CANCELLED";
            return (
              <div key={a.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {jo.productionStage.name}{" "}
                    <span className="text-xs text-zinc-400">
                      ({jo.jobNumber} · Lot {jo.lot.lotNumber})
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300 sm:grid-cols-4">
                  <div>Planned: {jo.plannedQuantity}</div>
                  <div>Completed: {jo.completedQuantity}</div>
                  <div>My assigned qty: {a.assignedQuantity}</div>
                  <div>Remaining: {remaining}</div>
                </div>
                {canLog && (
                  <button
                    type="button"
                    onClick={() => openProgressModal(jo)}
                    className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    Log My Progress
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">My Submitted Entries</h2>
        {entries.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">You haven&apos;t submitted any progress entries yet.</p>
        )}
        {entries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Job Order</th>
                  <th className="px-3 py-2">Completed</th>
                  <th className="px-3 py-2">Rejected</th>
                  <th className="px-3 py-2">Damaged</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Supervisor Remark</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                      {e.jobOrder.productionStage.name} ({e.jobOrder.jobNumber})
                    </td>
                    <td className="px-3 py-2">{e.completedQuantity}</td>
                    <td className="px-3 py-2">{e.rejectedQuantity}</td>
                    <td className="px-3 py-2">{e.damagedQuantity}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_BADGE_CLASS[e.approvalStatus]}`}>
                        {APPROVAL_LABELS[e.approvalStatus]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{e.approvalRemark || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!progressTarget} onClose={() => setProgressTarget(null)} title="Log My Progress">
        {progressTarget && (
          <div className="space-y-4">
            {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Completed" htmlFor="myCompleted">
                <input
                  id="myCompleted"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={completed}
                  onChange={(e) => setCompleted(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Rejected" htmlFor="myRejected">
                <input
                  id="myRejected"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={rejected}
                  onChange={(e) => setRejected(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Damaged" htmlFor="myDamaged">
                <input
                  id="myDamaged"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={damaged}
                  onChange={(e) => setDamaged(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Remaining on this job order: {remainingOf(progressTarget)}</p>
            <FormField label="Remarks" htmlFor="myRemarks">
              <input id="myRemarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} />
            </FormField>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              This entry will show as Pending until your Supervisor approves it — it won&apos;t count toward the job order
              until then.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProgressTarget(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitProgress}
                disabled={isBusy}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Submitting…" : "Submit for Approval"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

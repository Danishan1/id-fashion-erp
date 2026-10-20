"use client";

import { useEffect, useRef, useState } from "react";
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

interface Slip {
  id: string;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  contextLabel: string | null;
  uploadedBy: { id: string; fullName: string } | null;
}

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const APPROVAL_BADGE_CLASS: Record<ApprovalStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-300",
};

// Touch-friendly sizes (P4): every action is at least 48px tall on a phone.
const BIG_PRIMARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 text-base font-semibold text-white hover:bg-indigo-500 disabled:opacity-60";
const BIG_SECONDARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-base font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";
const BIG_INPUT = `${textInputClass()} min-h-12 text-base`;

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function remainingOf(jo: JobOrderRow) {
  return Number(jo.plannedQuantity) - Number(jo.completedQuantity) - Number(jo.rejectedQuantity) - Number(jo.damagedQuantity);
}

type Tab = "tasks" | "submitted";

export function MyWorkClient() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [entries, setEntries] = useState<SubmittedEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped after every mutation to re-run the load effect.
  const [refreshKey, setRefreshKey] = useState(0);

  // Log progress
  const [progressTarget, setProgressTarget] = useState<JobOrderRow | null>(null);
  const [completed, setCompleted] = useState("0");
  const [rejected, setRejected] = useState("0");
  const [damaged, setDamaged] = useState("0");
  const [remarks, setRemarks] = useState("");
  // Hand back
  const [handbackTarget, setHandbackTarget] = useState<AssignmentRow | null>(null);
  const [handbackQty, setHandbackQty] = useState("1");
  const [handbackReason, setHandbackReason] = useState("");
  // Slips
  const [slipTarget, setSlipTarget] = useState<JobOrderRow | null>(null);
  const [slips, setSlips] = useState<Slip[] | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const loadSlips = (jobOrderId: string) => {
    setSlips(null);
    fetch(`/api/v1/job-orders/${jobOrderId}/slips`)
      .then(async (res) => {
        if (!res.ok) {
          setFormError(await parseErrorMessage(res, "Couldn't load slips."));
          setSlips([]);
          return;
        }
        const body = await res.json();
        setSlips(body.data ?? []);
      })
      .catch(() => {
        setFormError("Couldn't load slips.");
        setSlips([]);
      });
  };

  const openProgressModal = (jo: JobOrderRow) => {
    setProgressTarget(jo);
    setCompleted("0");
    setRejected("0");
    setDamaged("0");
    setRemarks("");
    setFormError(null);
  };

  const openHandback = (a: AssignmentRow) => {
    setHandbackTarget(a);
    setHandbackQty("1");
    setHandbackReason("");
    setFormError(null);
  };

  const openSlips = (jo: JobOrderRow) => {
    setSlipTarget(jo);
    setFormError(null);
    loadSlips(jo.id);
  };

  const submitProgress = async () => {
    if (!progressTarget || isBusy) return;
    setIsBusy(true);
    setFormError(null);
    try {
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
        return;
      }
      setProgressTarget(null);
      setRefreshKey((k) => k + 1);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const submitHandback = async () => {
    if (!handbackTarget || isBusy) return;
    setIsBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/v1/job-order-assignments/${handbackTarget.id}/handback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: Number(handbackQty), reason: handbackReason }),
      });
      if (!res.ok) {
        setFormError(await parseErrorMessage(res, "Failed to hand back."));
        return;
      }
      setHandbackTarget(null);
      setRefreshKey((k) => k + 1);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const uploadSlip = async (file: File | undefined) => {
    if (!file || !slipTarget || isBusy) return;
    setIsBusy(true);
    setFormError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/job-orders/${slipTarget.id}/slips`, { method: "POST", body: form });
      if (!res.ok) {
        setFormError(await parseErrorMessage(res, "Upload failed."));
        return;
      }
      loadSlips(slipTarget.id);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsBusy(false);
      if (cameraInput.current) cameraInput.current.value = "";
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const term = search.trim().toLowerCase();
  const filteredAssignments = term
    ? (assignments ?? []).filter((a) =>
        [a.jobOrder.jobNumber, a.jobOrder.productionStage.name, a.jobOrder.lot.lotNumber].join(" ").toLowerCase().includes(term)
      )
    : (assignments ?? []);
  const filteredEntries = term
    ? entries.filter((e) =>
        [e.jobOrder.jobNumber, e.jobOrder.productionStage.name, APPROVAL_LABELS[e.approvalStatus]].join(" ").toLowerCase().includes(term)
      )
    : entries;
  const pendingCount = entries.filter((e) => e.approvalStatus === "PENDING").length;

  const tabClass = (t: Tab) =>
    `flex-1 min-h-12 rounded-lg px-3 text-base font-semibold ${
      tab === t
        ? "bg-indigo-600 text-white"
        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
    }`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "My Work" }]} />
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">My Work</h1>
        <p className="mt-1 text-base text-zinc-600 dark:text-zinc-400">
          Log your progress, hand back pieces you can&apos;t do, and upload slips. Your supervisor approves each entry.
        </p>
      </div>

      <div className="flex gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "tasks"} onClick={() => setTab("tasks")} className={tabClass("tasks")}>
          My Tasks{assignments ? ` (${assignments.length})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "submitted"}
          onClick={() => setTab("submitted")}
          className={tabClass("submitted")}
        >
          Submitted{pendingCount > 0 ? ` (${pendingCount} waiting)` : ""}
        </button>
      </div>

      {!loadError && (assignments === null || assignments.length > 0 || entries.length > 0) && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search job, stage or lot…"
          aria-label="Search"
          className={BIG_INPUT}
        />
      )}

      {loadError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {loadError}
        </div>
      )}

      {tab === "tasks" && !loadError && (
        <div className="space-y-4">
          {assignments === null && <p className="text-base text-zinc-500">Loading…</p>}
          {assignments !== null && assignments.length === 0 && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">No work is assigned to you right now.</p>
          )}
          {assignments !== null && assignments.length > 0 && filteredAssignments.length === 0 && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">Nothing matches your search.</p>
          )}
          {filteredAssignments.map((a) => {
            const jo = a.jobOrder;
            // My own entries still waiting for approval: they don't count
            // toward Completed yet, but those pieces are no longer "remaining".
            const pending = entries
              .filter((e) => e.approvalStatus === "PENDING" && e.jobOrder.jobNumber === jo.jobNumber)
              .reduce((sum, e) => sum + Number(e.completedQuantity) + Number(e.rejectedQuantity) + Number(e.damagedQuantity), 0);
            const remaining = Math.max(0, remainingOf(jo) - pending);
            const canLog = remaining > 0 && jo.status !== "CANCELLED";
            return (
              <div key={a.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{jo.productionStage.name}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {jo.jobNumber} · Lot {jo.lot.lotNumber}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-base">
                  <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
                    <dt className="text-sm text-zinc-500 dark:text-zinc-400">My pieces</dt>
                    <dd className="font-semibold text-zinc-900 dark:text-zinc-50">{Number(a.assignedQuantity)}</dd>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800">
                    <dt className="text-sm text-zinc-500 dark:text-zinc-400">Remaining</dt>
                    <dd className="font-semibold text-zinc-900 dark:text-zinc-50">{remaining}</dd>
                  </div>
                </dl>
                {pending > 0 && (
                  <p className="mt-2 text-sm text-amber-800 dark:text-amber-400">
                    {pending} piece(s) waiting for supervisor approval.
                  </p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button type="button" onClick={() => openProgressModal(jo)} disabled={!canLog} className={BIG_PRIMARY}>
                    Log Progress
                  </button>
                  <button type="button" onClick={() => openHandback(a)} className={BIG_SECONDARY}>
                    Hand Back
                  </button>
                  <button type="button" onClick={() => openSlips(jo)} className={BIG_SECONDARY}>
                    Slips
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "submitted" && (
        <div className="space-y-3">
          {entries.length === 0 && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">You haven&apos;t submitted any progress yet.</p>
          )}
          {entries.length > 0 && filteredEntries.length === 0 && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">Nothing matches your search.</p>
          )}
          {filteredEntries.map((e) => (
            <div key={e.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {e.jobOrder.productionStage.name}{" "}
                  <span className="text-sm font-normal text-zinc-500">({e.jobOrder.jobNumber})</span>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${APPROVAL_BADGE_CLASS[e.approvalStatus]}`}>
                  {APPROVAL_LABELS[e.approvalStatus]}
                </span>
              </div>
              <p className="mt-2 text-base text-zinc-700 dark:text-zinc-300">
                Done {Number(e.completedQuantity)} · Rejected {Number(e.rejectedQuantity)} · Damaged {Number(e.damagedQuantity)}
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{new Date(e.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
              {e.approvalRemark && (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Supervisor: {e.approvalRemark}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Log progress */}
      <Modal open={!!progressTarget} onClose={() => setProgressTarget(null)} title="Log Progress">
        {progressTarget && (
          <div className="space-y-4">
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              {progressTarget.productionStage.name} · {progressTarget.jobNumber}
            </p>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Done" htmlFor="myCompleted">
                <input id="myCompleted" type="number" inputMode="numeric" min={0} step={1} value={completed} onChange={(e) => setCompleted(e.target.value)} className={BIG_INPUT} />
              </FormField>
              <FormField label="Rejected" htmlFor="myRejected">
                <input id="myRejected" type="number" inputMode="numeric" min={0} step={1} value={rejected} onChange={(e) => setRejected(e.target.value)} className={BIG_INPUT} />
              </FormField>
              <FormField label="Damaged" htmlFor="myDamaged">
                <input id="myDamaged" type="number" inputMode="numeric" min={0} step={1} value={damaged} onChange={(e) => setDamaged(e.target.value)} className={BIG_INPUT} />
              </FormField>
            </div>
            <FormField label="Remarks" htmlFor="myRemarks">
              <input id="myRemarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={BIG_INPUT} />
            </FormField>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">It counts once your supervisor approves it.</p>
            {formError && <p className="text-base text-red-700 dark:text-red-400">{formError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setProgressTarget(null)} className={BIG_SECONDARY}>
                Cancel
              </button>
              <button type="button" onClick={submitProgress} disabled={isBusy} className={BIG_PRIMARY}>
                {isBusy ? "Sending…" : "Send for Approval"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Hand back */}
      <Modal open={!!handbackTarget} onClose={() => setHandbackTarget(null)} title="Hand Back Pieces">
        {handbackTarget && (
          <div className="space-y-4">
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              {handbackTarget.jobOrder.productionStage.name} · {handbackTarget.jobOrder.jobNumber}. You have{" "}
              {Number(handbackTarget.assignedQuantity)} piece(s) assigned. Pieces you hand back go back to your supervisor to give
              to someone else.
            </p>
            <FormField label="Pieces to hand back" htmlFor="handbackQty" required>
              <input id="handbackQty" type="number" inputMode="numeric" min={1} step={1} value={handbackQty} onChange={(e) => setHandbackQty(e.target.value)} className={BIG_INPUT} />
            </FormField>
            <FormField label="Reason" htmlFor="handbackReason" required>
              <input
                id="handbackReason"
                value={handbackReason}
                onChange={(e) => setHandbackReason(e.target.value)}
                placeholder="e.g. machine breakdown, end of shift"
                className={BIG_INPUT}
              />
            </FormField>
            {formError && <p className="text-base text-red-700 dark:text-red-400">{formError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setHandbackTarget(null)} className={BIG_SECONDARY}>
                Cancel
              </button>
              <button type="button" onClick={submitHandback} disabled={isBusy || !handbackReason.trim()} className={BIG_PRIMARY}>
                {isBusy ? "Sending…" : "Hand Back"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Slips */}
      <Modal open={!!slipTarget} onClose={() => setSlipTarget(null)} title="Slips">
        {slipTarget && (
          <div className="space-y-4">
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              {slipTarget.productionStage.name} · {slipTarget.jobNumber}. Take a photo of a handwritten slip or upload a PDF.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => cameraInput.current?.click()} disabled={isBusy} className={BIG_PRIMARY}>
                Take Photo
              </button>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={isBusy} className={BIG_SECONDARY}>
                Choose File
              </button>
            </div>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => uploadSlip(e.target.files?.[0])}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => uploadSlip(e.target.files?.[0])}
            />
            {isBusy && <p className="text-base text-zinc-600">Uploading…</p>}
            {formError && <p className="text-base text-red-700 dark:text-red-400">{formError}</p>}
            {slips === null && <p className="text-base text-zinc-500">Loading…</p>}
            {slips !== null && slips.length === 0 && <p className="text-base text-zinc-600 dark:text-zinc-400">No slips yet.</p>}
            {slips !== null && slips.length > 0 && (
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {slips.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-base text-zinc-900 dark:text-zinc-100">{s.fileName}</div>
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        {s.uploadedBy?.fullName ?? "—"} · {new Date(s.uploadedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </div>
                    </div>
                    <a
                      href={`/api/v1/job-orders/${slipTarget.id}/slips/${s.id}?disposition=inline`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-12 items-center rounded-lg border border-zinc-300 px-4 text-base font-medium text-indigo-700 dark:border-zinc-700 dark:text-indigo-300"
                    >
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

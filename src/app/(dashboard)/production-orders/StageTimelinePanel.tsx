"use client";

import { useEffect, useState } from "react";

type StageStatus = "NOT_STARTED" | "PENDING" | "IN_PROGRESS" | "AT_JOB_WORK" | "READY_TO_FORWARD" | "COMPLETED";

interface StageRow {
  stageId: string;
  stageName: string;
  sequence: number;
  isFinal: boolean;
  receivedQuantity: number;
  assignedQuantity: number;
  completedQuantity: number;
  rejectedQuantity: number;
  damagedQuantity: number;
  extraQuantity: number;
  sentToJobWorkQuantity: number;
  receivedFromJobWorkQuantity: number;
  jobWorkRejectedQuantity: number;
  jobWorkDamagedQuantity: number;
  pendingAtJobWorkQuantity: number;
  forwardedQuantity: number;
  availableForNextStageQuantity: number;
  status: StageStatus;
}

interface HistoryEvent {
  at: string;
  action: string;
  user: string;
  productionOrder: string;
  salesOrder: string | null;
  lot: string | null;
  stage: string | null;
  nextStage: string | null;
  assignedQuantity: number | null;
  sentQuantity: number | null;
  receivedQuantity: number | null;
  rejectedQuantity: number | null;
  damagedQuantity: number | null;
  quantity: number | null;
  remarks: string;
}

const STATUS_LABEL: Record<StageStatus, string> = {
  NOT_STARTED: "Not started",
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  AT_JOB_WORK: "At job work",
  READY_TO_FORWARD: "Ready for next stage",
  COMPLETED: "Completed",
};

const STATUS_CLASS: Record<StageStatus, string> = {
  NOT_STARTED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  PENDING: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  AT_JOB_WORK: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  READY_TO_FORWARD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const ACTION_LABEL: Record<string, string> = {
  LOT_CREATED: "Lot Created",
  ASSIGNED: "Assigned",
  MATERIAL_REQUESTED: "Material Requested",
  MATERIAL_ISSUED: "Material Issued",
  MOVED_TO_NEXT_STAGE: "Moved to Next Stage",
  REWORK: "Sent Back for Rework",
  ADJUSTMENT: "Adjustment",
  PROGRESS_LOGGED: "Progress Logged",
  QC_INSPECTED: "QC Inspected",
  SENT_TO_JOB_WORK: "Sent to Job Work",
  JOB_WORK_RECEIVED: "Job Work Received",
  EXTRA_PRODUCTION_CREATED: "Extra Production Created",
};

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

function Cell({ value, tone }: { value: number; tone?: "neg" | "pos" }) {
  if (!value) return <td className="px-2 py-1.5 text-right text-zinc-300 dark:text-zinc-600">0</td>;
  const cls = tone === "neg" ? "text-red-600 dark:text-red-400" : tone === "pos" ? "font-semibold text-emerald-700 dark:text-emerald-400" : "";
  return <td className={`px-2 py-1.5 text-right ${cls}`}>{fmt(value)}</td>;
}

/**
 * Production Stage Timeline + History (2026-09-29): stage-by-stage quantities
 * (assigned, completed, sent to / received from job work, rejected/damaged,
 * moved on, available for the next stage) and the dated movement history.
 * `refreshKey` lets the parent re-fetch after any action.
 */
export function StageTimelinePanel({
  kind,
  id,
  refreshKey = 0,
}: {
  kind: "lot" | "productionOrder";
  id: string;
  refreshKey?: number;
}) {
  const [stages, setStages] = useState<StageRow[] | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const url = kind === "lot" ? `/api/v1/lots/${id}/timeline` : `/api/v1/production-orders/${id}/timeline`;
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load the stage timeline.");
        return body.data as { stages: StageRow[]; history: HistoryEvent[] };
      })
      .then((data) => {
        setStages(data.stages);
        setHistory(data.history);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [kind, id, refreshKey]);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Production Stage Timeline</h2>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {showHistory ? "Hide" : "Show"} movement history ({history.length})
          </button>
        )}
      </div>
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {!stages && !loadError && <p className="text-xs text-zinc-400">Loading…</p>}
      {stages && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-700">
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">Stage</th>
                <th className="px-2 py-1.5 text-right font-medium">Received</th>
                <th className="px-2 py-1.5 text-right font-medium">Assigned</th>
                <th className="px-2 py-1.5 text-right font-medium">Completed</th>
                <th className="px-2 py-1.5 text-right font-medium">Sent to Job Work</th>
                <th className="px-2 py-1.5 text-right font-medium">Received from Job Work</th>
                <th className="px-2 py-1.5 text-right font-medium">Rejected / Damaged</th>
                <th className="px-2 py-1.5 text-right font-medium">Moved On</th>
                <th className="px-2 py-1.5 text-right font-medium">Available for Next Stage</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.stageId} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-2 py-1.5 text-zinc-400">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-zinc-800 dark:text-zinc-100">
                    {s.stageName}
                    {s.isFinal && <span className="ml-1 text-xs text-zinc-400">(final)</span>}
                    {s.extraQuantity > 0 && <span className="ml-1 text-xs text-amber-600">+{fmt(s.extraQuantity)} extra</span>}
                  </td>
                  <Cell value={s.receivedQuantity} />
                  <Cell value={s.assignedQuantity} />
                  <Cell value={s.completedQuantity} />
                  <Cell value={s.sentToJobWorkQuantity} />
                  <td className="px-2 py-1.5 text-right">
                    {s.sentToJobWorkQuantity > 0 ? (
                      <>
                        {fmt(s.receivedFromJobWorkQuantity)}
                        {s.pendingAtJobWorkQuantity > 0 && (
                          <span className="ml-1 text-purple-600 dark:text-purple-400">({fmt(s.pendingAtJobWorkQuantity)} pending)</span>
                        )}
                      </>
                    ) : (
                      <span className="text-zinc-300 dark:text-zinc-600">0</span>
                    )}
                  </td>
                  <Cell
                    value={s.rejectedQuantity + s.damagedQuantity + s.jobWorkRejectedQuantity + s.jobWorkDamagedQuantity}
                    tone="neg"
                  />
                  <Cell value={s.forwardedQuantity} />
                  <Cell value={s.availableForNextStageQuantity} tone="pos" />
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showHistory && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-700">
                <th className="px-2 py-1.5 font-medium">Date &amp; Time</th>
                <th className="px-2 py-1.5 font-medium">Action</th>
                <th className="px-2 py-1.5 font-medium">User</th>
                {kind === "productionOrder" && <th className="px-2 py-1.5 font-medium">Lot</th>}
                <th className="px-2 py-1.5 font-medium">Stage</th>
                <th className="px-2 py-1.5 font-medium">Next Stage</th>
                <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                <th className="px-2 py-1.5 text-right font-medium">Rejected / Damaged</th>
                <th className="px-2 py-1.5 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {history.map((e, i) => (
                <tr key={i} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                  <td className="whitespace-nowrap px-2 py-1.5 text-zinc-500">{new Date(e.at).toLocaleString("en-IN")}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium text-zinc-800 dark:text-zinc-100">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="px-2 py-1.5">{e.user}</td>
                  {kind === "productionOrder" && <td className="px-2 py-1.5">{e.lot ?? "—"}</td>}
                  <td className="px-2 py-1.5">{e.stage ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.nextStage ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right">{e.quantity === null ? "—" : fmt(e.quantity)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {(e.rejectedQuantity ?? 0) + (e.damagedQuantity ?? 0) > 0 ? fmt((e.rejectedQuantity ?? 0) + (e.damagedQuantity ?? 0)) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{e.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

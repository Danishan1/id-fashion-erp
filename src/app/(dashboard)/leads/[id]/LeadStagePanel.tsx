"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { STAGE_KIND_BADGE_CLASS, type StageKind } from "../statusLabels";

interface Stage {
  id: string;
  name: string;
  kind: StageKind;
}
interface LostReason {
  id: string;
  name: string;
}
interface StageHistoryRow {
  id: string;
  changedAt: string;
  comment: string | null;
  fromStage: { name: string } | null;
  toStage: { name: string; kind: StageKind };
  changedBy: { fullName: string };
}
interface AssignmentHistoryRow {
  id: string;
  assignedAt: string;
  reason: string | null;
  fromUser: { fullName: string } | null;
  toUser: { fullName: string } | null;
  assignedBy: { fullName: string };
}

interface Props {
  leadId: string;
  currentStage: Stage;
  lostReason: { name: string } | null;
  lostCompetitor: string | null;
  lostComment: string | null;
}

/**
 * Stage control for one lead: an at-a-glance stepper of the open pipeline,
 * a stage-change action (every move goes through POST /leads/:id/stage so it
 * is always recorded in history), a mandatory lost-reason capture when the
 * target stage is a LOST-kind stage, and the stage/assignment history.
 */
export function LeadStagePanel({ leadId, currentStage, lostReason, lostCompetitor, lostComment }: Props) {
  const router = useRouter();
  const [stages, setStages] = useState<Stage[]>([]);
  const [lostReasons, setLostReasons] = useState<LostReason[]>([]);
  const [stageHistory, setStageHistory] = useState<StageHistoryRow[]>([]);
  const [assignmentHistory, setAssignmentHistory] = useState<AssignmentHistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [targetId, setTargetId] = useState("");
  const [comment, setComment] = useState("");
  const [showLostModal, setShowLostModal] = useState(false);
  const [lost, setLost] = useState({ lostReasonId: "", lostCompetitor: "", lostComment: "", lostCanRevisit: false, nextFollowupAt: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/crm/pipeline-stages?activeOnly=true")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setStages(body?.data ?? []))
      .catch(() => setStages([]));
    fetch("/api/v1/crm/lost-reasons?activeOnly=true")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setLostReasons(body?.data ?? []))
      .catch(() => setLostReasons([]));
  }, []);

  const loadHistory = () =>
    fetch(`/api/v1/leads/${leadId}/history`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        setStageHistory(body?.data?.stageHistory ?? []);
        setAssignmentHistory(body?.data?.assignmentHistory ?? []);
      })
      .catch(() => null);

  const target = stages.find((s) => s.id === targetId);

  const post = async (payload: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/v1/leads/${leadId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to change stage.");
      return false;
    }
    setTargetId("");
    setComment("");
    setShowLostModal(false);
    setLost({ lostReasonId: "", lostCompetitor: "", lostComment: "", lostCanRevisit: false, nextFollowupAt: "" });
    if (showHistory) loadHistory();
    router.refresh();
    return true;
  };

  const submitChange = () => {
    if (!target) return;
    if (target.kind === "LOST") {
      setShowLostModal(true);
      return;
    }
    post({ stageId: target.id, comment: comment || undefined });
  };

  const openStages = stages.filter((s) => s.kind === "OPEN");
  const currentOpenIndex = openStages.findIndex((s) => s.id === currentStage.id);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {openStages.length > 0 && (
        <ol className="flex flex-wrap gap-1 text-[11px]">
          {openStages.map((s, i) => {
            const isCurrent = s.id === currentStage.id;
            const isPast = currentOpenIndex >= 0 && i < currentOpenIndex;
            return (
              <li
                key={s.id}
                className={`rounded px-2 py-1 ${
                  isCurrent
                    ? "bg-indigo-600 font-semibold text-white"
                    : isPast
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {s.name}
              </li>
            );
          })}
        </ol>
      )}

      {currentStage.kind === "LOST" && lostReason && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          Lost — {lostReason.name}
          {lostCompetitor ? ` · Competitor: ${lostCompetitor}` : ""}
          {lostComment ? ` · ${lostComment}` : ""}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <FormField label="Move to stage" htmlFor="targetStage">
          <select id="targetStage" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={textInputClass()}>
            <option value="">— Select stage —</option>
            {stages
              .filter((s) => s.id !== currentStage.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.kind !== "OPEN" ? ` (${s.kind.toLowerCase()})` : ""}
                </option>
              ))}
          </select>
        </FormField>
        <div className="flex-1">
          <FormField label="Comment (optional)" htmlFor="stageComment">
            <input id="stageComment" value={comment} onChange={(e) => setComment(e.target.value)} className={textInputClass()} />
          </FormField>
        </div>
        <button
          type="button"
          onClick={submitChange}
          disabled={!target || saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Change Stage"}
        </button>
      </div>

      {error && !showLostModal && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={() => {
          if (!showHistory) loadHistory();
          setShowHistory((v) => !v);
        }}
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {showHistory ? "Hide" : "Show"} stage & assignment history
      </button>

      {showHistory && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Stage History</h3>
            {stageHistory.length === 0 ? (
              <p className="text-xs text-zinc-500">No stage changes yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {stageHistory.map((h) => (
                  <li key={h.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{h.fromStage?.name ?? "—"}</span>→
                      <span className={`rounded px-1.5 py-0.5 font-medium ${STAGE_KIND_BADGE_CLASS[h.toStage.kind]}`}>{h.toStage.name}</span>
                    </div>
                    <div className="text-zinc-500">
                      {new Date(h.changedAt).toLocaleString()} · {h.changedBy.fullName}
                    </div>
                    {h.comment && <div className="text-zinc-700 dark:text-zinc-300">{h.comment}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Assignment History</h3>
            {assignmentHistory.length === 0 ? (
              <p className="text-xs text-zinc-500">Never assigned.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {assignmentHistory.map((h) => (
                  <li key={h.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                    <div>
                      {h.fromUser?.fullName ?? "Unassigned"} → <span className="font-medium">{h.toUser?.fullName ?? "Unassigned"}</span>
                    </div>
                    <div className="text-zinc-500">
                      {new Date(h.assignedAt).toLocaleString()} · by {h.assignedBy.fullName}
                      {h.reason ? ` · ${h.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal open={showLostModal} onClose={() => setShowLostModal(false)} title={`Mark as ${target?.name ?? "Lost"}`}>
        <div className="space-y-3">
          <FormField label="Lost Reason" htmlFor="lostReasonId" required>
            <select
              id="lostReasonId"
              required
              value={lost.lostReasonId}
              onChange={(e) => setLost((p) => ({ ...p, lostReasonId: e.target.value }))}
              className={textInputClass()}
            >
              <option value="">— Select reason —</option>
              {lostReasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Competitor (if known)" htmlFor="lostCompetitor">
            <input
              id="lostCompetitor"
              value={lost.lostCompetitor}
              onChange={(e) => setLost((p) => ({ ...p, lostCompetitor: e.target.value }))}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Comment" htmlFor="lostComment">
            <textarea
              id="lostComment"
              value={lost.lostComment}
              onChange={(e) => setLost((p) => ({ ...p, lostComment: e.target.value }))}
              className={textInputClass()}
              rows={2}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={lost.lostCanRevisit} onChange={(e) => setLost((p) => ({ ...p, lostCanRevisit: e.target.checked }))} />
            Possibility of future business — follow up later
          </label>
          {lost.lostCanRevisit && (
            <FormField label="Next follow-up" htmlFor="nextFollowupAt">
              <input
                id="nextFollowupAt"
                type="datetime-local"
                value={lost.nextFollowupAt}
                onChange={(e) => setLost((p) => ({ ...p, nextFollowupAt: e.target.value }))}
                className={textInputClass()}
              />
            </FormField>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowLostModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!lost.lostReasonId || saving}
              onClick={() =>
                target &&
                post({
                  stageId: target.id,
                  comment: comment || undefined,
                  lostReasonId: lost.lostReasonId,
                  lostCompetitor: lost.lostCompetitor || undefined,
                  lostComment: lost.lostComment || undefined,
                  lostCanRevisit: lost.lostCanRevisit,
                  nextFollowupAt: lost.lostCanRevisit && lost.nextFollowupAt ? lost.nextFollowupAt : undefined,
                })
              }
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Mark Lost"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

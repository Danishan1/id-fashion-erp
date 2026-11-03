"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { REVISION_STATUS_LABELS, type MetricUnit, type SalesTargetRevisionStatusKey } from "@/modules/sales-marketing/performance/performance-registry";
import { getApiErrorMessage } from "@/lib/api-client";
import { AttainmentCell, Badge, CARD, EventList, TextDialog, fmt, gapText, type AttainmentView, type PerformanceEvent, type TextDialogSpec } from "./performance-ui";

interface Revision {
  id: string;
  revisionNumber: number;
  status: SalesTargetRevisionStatusKey;
  targetValue: number;
  notes: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedAfterPeriodStart: boolean;
  decisionComment: string | null;
  supersededAt: string | null;
}

export interface TargetDetail {
  id: string;
  scope: string;
  scopeLabel: string;
  userId: string | null;
  territoryId: string | null;
  subject: string;
  metric: string;
  metricLabel: string;
  metricDefinition: string;
  dateBasis: string;
  unit: MetricUnit;
  periodType: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  archived: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  periodEnded: boolean;
  progress: { state: "UPCOMING" | "CURRENT" | "ENDED"; totalDays: number; elapsedDays: number; remainingDays: number };
  attainment: AttainmentView;
  documents: number;
  calculatedAt: string;
  canApprove: boolean;
  revisions: Revision[];
  events: PerformanceEvent[];
}

const TONE: Record<SalesTargetRevisionStatusKey, "green" | "amber" | "zinc"> = { APPROVED: "green", PENDING_APPROVAL: "amber", DRAFT: "zinc", SUPERSEDED: "zinc" };

export function TargetDetailClient({ initial, perms }: { initial: TargetDetail; perms: { edit: boolean; approve: boolean; reject: boolean } }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  const open = d.revisions.find((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL") ?? null;
  const [draft, setDraft] = useState({ targetValue: open ? String(open.targetValue) : "", notes: open?.notes ?? "" });
  const base = `/api/v1/sales-marketing/performance/targets/${d.id}`;
  const frozen = d.archived || d.periodEnded;

  const load = (next: TargetDetail) => {
    setD(next);
    const o = next.revisions.find((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL");
    setDraft({ targetValue: o ? String(o.targetValue) : "", notes: o?.notes ?? "" });
  };

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", "x-toast": "off" }, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(await getApiErrorMessage(res));
      return false;
    }
    const { data } = await res.json();
    if (data?.deleted) {
      router.push("/sales-marketing/targets");
      return false;
    }
    load(data);
    setDialog(null);
    return true;
  };

  const act = (action: string, body: Record<string, string> = {}) => open && call(`${base}/revisions/${open.id}/${action}`, "POST", body);
  const ask = (spec: TextDialogSpec) => (setError(null), setDialog(spec));
  const a = d.attainment;
  const elapsedPct = d.progress.totalDays ? Math.round((d.progress.elapsedDays / d.progress.totalDays) * 100) : 0;

  return (
    <div className="space-y-4">
      {error && !dialog && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {d.archived && (
        <p className="rounded-md bg-zinc-100 p-3 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Archived by {d.archivedBy} on {d.archivedAt ? formatDate(d.archivedAt) : "—"}: {d.archiveReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${CARD} space-y-2 text-sm lg:col-span-1`} aria-label="What is measured">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{d.subject}</span>
            <Badge tone="indigo">{d.scopeLabel}</Badge>
          </div>
          <div>
            <span className="font-medium">{d.metricLabel}</span> · {d.periodLabel}
          </div>
          <div className="text-xs text-zinc-500">
            {formatDate(d.periodStart)} – {formatDate(d.periodEnd)} ·{" "}
            {d.progress.state === "UPCOMING" ? "not started" : d.progress.state === "ENDED" ? "ended" : `day ${d.progress.elapsedDays} of ${d.progress.totalDays} (${elapsedPct}%), ${d.progress.remainingDays} left`}
          </div>
          <p className="text-xs text-zinc-500">
            {d.metricDefinition} Date: {d.dateBasis.toLowerCase()}.
          </p>
        </section>

        <section className={`${CARD} lg:col-span-2`} aria-label="Attainment">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <div className="text-xs text-zinc-500">Approved target</div>
              <div className="text-xl font-semibold tabular-nums">{a.target === null ? "Not approved yet" : fmt(d.unit, a.target)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Actual</div>
              <div className="text-xl font-semibold tabular-nums">{fmt(d.unit, a.actual)}</div>
              <div className="text-xs text-zinc-500">
                from {d.documents} document{d.documents === 1 ? "" : "s"}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Gap</div>
              <div className="text-xl font-semibold tabular-nums">{gapText(d.unit, a.gap)}</div>
              {a.expectedToDate !== null && <div className="text-xs text-zinc-500">Expected by today: {fmt(d.unit, a.expectedToDate)}</div>}
            </div>
            <div>
              <div className="text-xs text-zinc-500">Attainment</div>
              <AttainmentCell a={a} />
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Calculated live {formatDateTime(d.calculatedAt)}.{" "}
            <Link href={`/sales-marketing/performance?metric=${d.metric}&periodType=${d.periodType}&periodStart=${d.periodStart}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              Open on the performance board
            </Link>
          </p>
        </section>
      </div>

      {open && !d.archived && (
        <section className={CARD} aria-labelledby="open-h">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="open-h" className="text-sm font-semibold">
              Revision {open.revisionNumber}
            </h2>
            <Badge tone={TONE[open.status]}>{REVISION_STATUS_LABELS[open.status]}</Badge>
            {open.decisionComment && open.status === "DRAFT" && <span className="text-xs text-amber-700 dark:text-amber-300">Sent back: {open.decisionComment}</span>}
          </div>
          {open.status === "DRAFT" && perms.edit && !frozen ? (
            <form
              className="mt-3 grid gap-3 sm:grid-cols-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await call(`${base}/revisions/${open.id}`, "PATCH", { targetValue: draft.targetValue, notes: draft.notes, version: open.version });
              }}
            >
              <FormField label="Target value" htmlFor="rv-value" required>
                <input id="rv-value" type="number" required min={0} step={d.unit === "CURRENCY" ? "0.01" : "1"} value={draft.targetValue} onChange={(e) => setDraft({ ...draft, targetValue: e.target.value })} className={textInputClass()} />
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Notes" htmlFor="rv-notes">
                  <input id="rv-notes" maxLength={2000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={textInputClass()} />
                </FormField>
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-3">
                <Button type="submit" size="xs" variant="secondary" isLoading={busy}>
                  Save draft
                </Button>
                <Button type="button" size="xs" isLoading={busy} onClick={() => ask({ action: "submit", title: "Submit for approval", help: "Someone else with approval rights must approve it.", field: { name: "comment", label: "Comment (optional)", required: false }, submitLabel: "Submit" })}>
                  Submit for approval
                </Button>
                <Button type="button" size="xs" variant="danger" isLoading={busy} onClick={() => ask({ action: "discard", title: "Discard this draft?", help: d.revisions.length === 1 ? "This target has never been approved, so the whole target is removed." : "The approved revision stays in force.", submitLabel: "Discard", danger: true })}>
                  Discard
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-2 text-sm">
              <div>
                Proposed: <span className="font-semibold tabular-nums">{fmt(d.unit, open.targetValue)}</span>
                {open.notes && <span className="text-zinc-500"> — {open.notes}</span>}
              </div>
              {open.submittedBy && (
                <div className="text-xs text-zinc-500">
                  Submitted by {open.submittedBy} {open.submittedAt ? formatDateTime(open.submittedAt) : ""}
                </div>
              )}
              {open.status === "PENDING_APPROVAL" && !frozen && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {perms.approve &&
                    (d.canApprove ? (
                      <Button size="xs" isLoading={busy} onClick={() => ask({ action: "approve", title: "Approve this target", field: { name: "comment", label: "Comment (optional)", required: false }, submitLabel: "Approve" })}>
                        Approve
                      </Button>
                    ) : (
                      <span className="text-xs text-zinc-500">You prepared or submitted this revision — someone else must approve it.</span>
                    ))}
                  {perms.reject && (
                    <Button size="xs" variant="secondary" isLoading={busy} onClick={() => ask({ action: "send-back", title: "Send back", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Send back" })}>
                      Send back
                    </Button>
                  )}
                  {perms.edit && (
                    <Button size="xs" variant="secondary" isLoading={busy} onClick={() => act("return-to-draft")}>
                      Return to draft
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {perms.edit && !d.archived && (
        <div className="flex flex-wrap gap-2">
          {!open && !frozen && (
            <Button size="xs" isLoading={busy} onClick={() => call(`${base}/revisions`, "POST")}>
              Change target
            </Button>
          )}
          <Button size="xs" variant="secondary" isLoading={busy} onClick={() => ask({ action: "archive", title: "Archive this target", help: "It disappears from the boards but stays readable here.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Archive", danger: true })}>
            Archive
          </Button>
          {frozen && !d.archived && <span className="self-center text-xs text-zinc-500">The period has ended — past targets can&apos;t be changed.</span>}
        </div>
      )}

      <section className={CARD} aria-labelledby="rev-h">
        <h2 id="rev-h" className="mb-2 text-sm font-semibold">
          Revisions
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="py-1.5 font-medium">#</th>
              <th className="py-1.5 text-right font-medium">Value</th>
              <th className="py-1.5 pl-3 font-medium">Status</th>
              <th className="py-1.5 font-medium">Prepared</th>
              <th className="py-1.5 font-medium">Approved</th>
              <th className="py-1.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {d.revisions.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                <td className="py-1.5">{r.revisionNumber}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.unit, r.targetValue)}</td>
                <td className="py-1.5 pl-3">
                  <Badge tone={TONE[r.status]}>{REVISION_STATUS_LABELS[r.status]}</Badge>
                </td>
                <td className="py-1.5 text-xs">
                  {r.createdBy}
                  <div className="text-zinc-500">{formatDate(r.createdAt)}</div>
                </td>
                <td className="py-1.5 text-xs">
                  {r.approvedBy ? (
                    <>
                      {r.approvedBy}
                      <div className="text-zinc-500">
                        {r.approvedAt ? formatDate(r.approvedAt) : ""}
                        {r.approvedAfterPeriodStart ? " · after the period started" : ""}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1.5 text-xs text-zinc-600 dark:text-zinc-300">{[r.notes, r.decisionComment].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={CARD} aria-labelledby="hist-h">
        <h2 id="hist-h" className="mb-2 text-sm font-semibold">
          History
        </h2>
        <EventList events={d.events} />
      </section>

      {dialog && (
        <TextDialog
          spec={dialog}
          busy={busy}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(body) => (dialog.action === "archive" ? call(`${base}/archive`, "POST", body) : act(dialog.action, body))}
        />
      )}
    </div>
  );
}

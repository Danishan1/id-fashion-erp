"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { Badge, CARD, EvaluationBadge, fmtCount, fmtDateTime, send, sourceLabel, useApi } from "./segment-ui";

interface AudienceItem {
  id: string;
  role: "INCLUDE" | "EXCLUDE";
  segment: { id: string; code: string; name: string; visible: boolean; status: string; sourceType: string; segmentType: string; currentVersionNumber: number; lastEvaluatedAt: string | null; lastEvaluationStatus: string | null; consentCheck: string; eligibilityChannel: string | null };
  pinned: boolean;
  snapshot: { id: string; versionNumber: number; finishedAt: string | null; memberCount: number | null; entriesAvailable: boolean; definitionDiffers: boolean; newerSnapshotExists: boolean } | null;
}
interface Audience {
  campaign: { id: string; code: string; status: string };
  sourceType: string | null;
  sourceLabel: string | null;
  items: AudienceItem[];
  summary: { audience: number; includedTotal: number; duplicatesRemoved: number; removedByExclusions: number } | null;
  missingSnapshots: string[];
  consentNote: string | null;
}
interface SegmentOption {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  memberCount: number | null;
  lastEvaluationId: string | null;
}

/**
 * Campaign → Audience (Phase 09): include / exclude segments, pinned
 * snapshots and the combined audience count. Selecting segments never sends,
 * publishes or launches anything.
 */
export function CampaignAudiencePanel({ campaignId, canEdit, canPickSegments, closed }: { campaignId: string; canEdit: boolean; canPickSegments: boolean; closed: boolean }) {
  const { data, error, reload, setData } = useApi<Audience>(`/api/v1/sales-marketing/campaigns/${campaignId}/audience`);
  const { data: options } = useApi<SegmentOption[]>(canEdit && canPickSegments && !closed ? "/api/v1/sales-marketing/segments/audience-options" : null);
  const [segmentId, setSegmentId] = useState("");
  const [role, setRole] = useState<"INCLUDE" | "EXCLUDE">("INCLUDE");
  const [pin, setPin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const editable = canEdit && !closed;

  const act = async (fn: () => Promise<Audience>) => {
    setBusy(true);
    setMsg(null);
    try {
      setData(await fn());
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  const usable = (options ?? []).filter((o) => !data.items.some((i) => i.segment.id === o.id) && (!data.sourceType || o.sourceType === data.sourceType));

  return (
    <section className={`${CARD} space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Audience</h2>
        {data.sourceLabel && <span className="text-xs text-zinc-500">{data.sourceLabel}</span>}
      </div>
      {data.items.length === 0 ? (
        <p className="text-sm text-zinc-500">No audience yet. Add one or more segments to include, and optionally segments to leave out.</p>
      ) : (
        <>
          {data.summary ? (
            <div className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
              <div className="text-2xl font-semibold tabular-nums">{fmtCount(data.summary.audience)}</div>
              <div className="text-xs text-zinc-500">
                unique records from the snapshots below · {fmtCount(data.summary.includedTotal)} included in total, {fmtCount(data.summary.duplicatesRemoved)} duplicates removed, {fmtCount(data.summary.removedByExclusions)} left out by exclusion segments
              </div>
            </div>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {data.items.every((i) => i.role === "EXCLUDE") ? "Add at least one segment to include." : `No complete snapshot for ${data.missingSnapshots.join(", ")} — refresh ${data.missingSnapshots.length > 1 ? "them" : "it"} to see the combined audience.`}
            </p>
          )}
          {data.consentNote && <p className="text-xs text-amber-700 dark:text-amber-400">{data.consentNote}</p>}
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {data.items.map((i) => (
              <li key={i.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={i.role === "INCLUDE" ? "green" : "red"}>{i.role === "INCLUDE" ? "Include" : "Exclude"}</Badge>
                  {i.segment.visible ? (
                    <Link href={`/sales-marketing/segments/${i.segment.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {i.segment.code} · {i.segment.name}
                    </Link>
                  ) : (
                    <span className="font-medium">
                      {i.segment.code} · {i.segment.name}
                    </span>
                  )}
                  {i.segment.status !== "ACTIVE" && <Badge tone="amber">{i.segment.status.toLowerCase()}</Badge>}
                  <span className="text-xs text-zinc-500">{sourceLabel(i.segment.sourceType)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  {i.snapshot ? (
                    <>
                      <span>
                        {i.pinned ? "Pinned snapshot" : "Latest snapshot"}: {fmtCount(i.snapshot.memberCount)} members, v{i.snapshot.versionNumber}, {fmtDateTime(i.snapshot.finishedAt)}
                      </span>
                      {i.snapshot.definitionDiffers && <Badge tone="amber">segment rules changed since (now v{i.segment.currentVersionNumber})</Badge>}
                      {i.snapshot.newerSnapshotExists && <Badge tone="amber">a newer snapshot exists</Badge>}
                      {!i.snapshot.entriesAvailable && <Badge tone="red">member list no longer kept</Badge>}
                    </>
                  ) : (
                    <span>
                      No completed snapshot yet <EvaluationBadge status={i.segment.lastEvaluationStatus} />
                    </span>
                  )}
                </div>
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    {i.pinned ? (
                      <Button size="xs" variant="secondary" disabled={busy} onClick={() => act(() => send<Audience>(`/api/v1/sales-marketing/campaigns/${campaignId}/audience/${i.id}`, "PATCH", { evaluationId: null }))}>
                        Follow latest snapshot
                      </Button>
                    ) : (
                      i.snapshot && (
                        <Button size="xs" variant="secondary" disabled={busy} onClick={() => act(() => send<Audience>(`/api/v1/sales-marketing/campaigns/${campaignId}/audience/${i.id}`, "PATCH", { evaluationId: i.snapshot!.id }))}>
                          Pin this snapshot
                        </Button>
                      )
                    )}
                    {i.pinned && i.snapshot?.newerSnapshotExists && (
                      <span className="text-xs text-zinc-500">Pinned stays as-is until you choose “Follow latest” or pin again.</span>
                    )}
                    <Button size="xs" variant="danger" disabled={busy} onClick={() => act(() => send<Audience>(`/api/v1/sales-marketing/campaigns/${campaignId}/audience/${i.id}`, "DELETE"))}>
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {editable && canPickSegments && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <select aria-label="Segment" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className={`${textInputClass()} !w-auto min-w-[16rem]`}>
            <option value="">Choose an active segment…</option>
            {usable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name} ({o.memberCount === null ? "not evaluated" : `${o.memberCount} members`})
              </option>
            ))}
          </select>
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "INCLUDE" | "EXCLUDE")} className={`${textInputClass()} !w-auto`}>
            <option value="INCLUDE">Include</option>
            <option value="EXCLUDE">Exclude</option>
          </select>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin its latest snapshot
          </label>
          <Button
            size="sm"
            isLoading={busy}
            disabled={!segmentId}
            onClick={() =>
              act(async () => {
                const opt = usable.find((o) => o.id === segmentId);
                const r = await send<Audience>(`/api/v1/sales-marketing/campaigns/${campaignId}/audience`, "POST", { segmentId, role, pinLatest: pin && Boolean(opt?.lastEvaluationId) });
                setSegmentId("");
                return r;
              })
            }
          >
            Add
          </Button>
        </div>
      )}
      {editable && !canPickSegments && <p className="text-xs text-zinc-500">You need access to Audience Segments to change the audience.</p>}
      {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
      <p className="text-xs text-zinc-500">Choosing an audience doesn&apos;t send anything. Being in an audience is not permission to contact — sending (later phases) checks consent again.</p>
    </section>
  );
}

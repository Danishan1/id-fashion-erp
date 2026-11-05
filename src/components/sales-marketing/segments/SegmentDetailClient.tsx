"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import {
  ELIGIBILITY_CHANNELS,
  ELIGIBILITY_CHANNEL_KEYS,
  EMPTY_CRITERIA,
  SEGMENT_ACTIONS,
  SEGMENT_REFRESH,
  SEGMENT_TYPES,
  describeCondition,
  validateCriteria,
  type SegmentActionKey,
  type SegmentCriteria,
  type SegmentSourceKey,
} from "@/modules/sales-marketing/segments/segment-registry";
import { CriteriaBuilder } from "./CriteriaBuilder";
import { Badge, CARD, CONSENT_TEXT, EvaluationBadge, REASON_LABELS, SegmentStatusBadge, fmtCount, fmtDateTime, send, sourceLabel, useApi, useFieldOptions, type LookupOptions, type RecordRow } from "./segment-ui";

interface Evaluation {
  id: string;
  versionNumber: number;
  status: string;
  trigger: string;
  runAs: string;
  requestedBy: string;
  matchedCount: number | null;
  excludedCount: number | null;
  ineligibleCount: number | null;
  memberCount: number | null;
  isKept: boolean;
  label: string | null;
  entriesPurged: boolean;
  error: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface SegmentDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  purpose: string | null;
  sourceType: SegmentSourceKey;
  segmentType: "DYNAMIC" | "STATIC";
  status: string;
  owner: { id: string; fullName: string };
  createdBy: string;
  createdAt: string;
  refreshSchedule: "MANUAL" | "NIGHTLY";
  version: number;
  currentVersionNumber: number;
  definition: { criteria: unknown; exclusionCriteria: unknown; eligibilityChannel: string | null } | null;
  consentCheck: string;
  summary: { memberCount: number | null; lastEvaluatedAt: string | null; lastEvaluationId: string | null; lastEvaluationStatus: string | null; lastError: string | null; lastCompletedVersion: number | null; definitionChangedSinceEvaluation: boolean; membersChangedSinceEvaluation: boolean };
  memberCounts: { included: number; excluded: number };
  versions: { versionNumber: number; criteria: unknown; exclusionCriteria: unknown; eligibilityChannel: string | null; changeNote: string | null; createdAt: string; createdBy: string }[];
  evaluations: Evaluation[];
  campaigns: { id: string; code: string; name: string; status: string; role: string; pinnedEvaluationId: string | null }[];
  events: { id: string; type: string; comment: string | null; at: string; by: string }[];
  canEdit: boolean;
}

const asCriteria = (v: unknown): SegmentCriteria => (v && typeof v === "object" && Array.isArray((v as SegmentCriteria).groups) ? (v as SegmentCriteria) : EMPTY_CRITERIA);
const TABS = ["Definition", "Preview", "Members", "Snapshots", "History"] as const;
type Tab = (typeof TABS)[number];

function labelMap(lookups: LookupOptions) {
  return Object.fromEntries(Object.values(lookups).flatMap((l) => (l ?? []).map((o) => [o.value, o.label])));
}

function DefinitionSummary({ source, criteria, lookups, empty }: { source: SegmentSourceKey; criteria: SegmentCriteria; lookups: LookupOptions; empty: string }) {
  if (!criteria.groups.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  const labels = labelMap(lookups);
  return (
    <ol className="space-y-1 text-sm">
      {criteria.groups.map((g, i) => (
        <li key={i}>
          {i > 0 && <span className="mr-1 text-xs font-semibold text-zinc-500">{criteria.match === "ALL" ? "AND" : "OR"}</span>}(
          {g.conditions.map((c, j) => (
            <span key={j}>
              {j > 0 && <span className="mx-1 text-xs font-semibold text-zinc-500">{g.match === "ALL" ? "and" : "or"}</span>}
              {describeCondition(source, c, labels)}
            </span>
          ))}
          )
        </li>
      ))}
    </ol>
  );
}

// ── Definition tab ──────────────────────────────────────────────────

function DefinitionTab({ s, lookups, onSaved, onPreviewDraft }: { s: SegmentDetail; lookups: LookupOptions; onSaved: () => void; onPreviewDraft: (draft: { criteria: SegmentCriteria; exclusionCriteria: SegmentCriteria; eligibilityChannel: string | null }) => void }) {
  const [criteria, setCriteria] = useState(asCriteria(s.definition?.criteria));
  const [exclusions, setExclusions] = useState(asCriteria(s.definition?.exclusionCriteria));
  const [channel, setChannel] = useState(s.definition?.eligibilityChannel ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = s.canEdit && s.status !== "ARCHIVED";
  const issues = [...(s.segmentType === "DYNAMIC" ? validateCriteria(s.sourceType, criteria).issues : []), ...validateCriteria(s.sourceType, exclusions).issues];
  const draft = { criteria, exclusionCriteria: exclusions, eligibilityChannel: channel || null };

  return (
    <div className="space-y-4">
      {s.segmentType === "DYNAMIC" && (
        <section className={CARD}>
          <h3 className="mb-2 font-medium">Include records that match</h3>
          {editable ? (
            <CriteriaBuilder source={s.sourceType} value={criteria} onChange={setCriteria} lookups={lookups} emptyHint={`No rules yet — every ${sourceLabel(s.sourceType).toLowerCase()} you can see would match. Add a group to narrow it.`} />
          ) : (
            <DefinitionSummary source={s.sourceType} criteria={criteria} lookups={lookups} empty="No rules — every record matches." />
          )}
        </section>
      )}
      {s.segmentType === "STATIC" && <p className={`${CARD} text-sm text-zinc-600 dark:text-zinc-300`}>A static segment has no inclusion rules — add members on the Members tab. Exclusion rules and the channel check below still apply.</p>}
      <section className={CARD}>
        <h3 className="mb-2 font-medium">Always leave out records that match</h3>
        {editable ? (
          <CriteriaBuilder source={s.sourceType} value={exclusions} onChange={setExclusions} lookups={lookups} emptyHint="No exclusion rules. (Archived, merged and deleted records are always left out; records excluded by hand are on the Members tab.)" />
        ) : (
          <DefinitionSummary source={s.sourceType} criteria={exclusions} lookups={lookups} empty="No exclusion rules." />
        )}
      </section>
      <section className={`${CARD} space-y-2`}>
        <FormField label="Meant for channel (eligibility)" htmlFor="d-channel">
          <select id="d-channel" disabled={!editable} value={channel} onChange={(e) => setChannel(e.target.value)} className={`${textInputClass()} max-w-xs`}>
            <option value="">No channel check</option>
            {ELIGIBILITY_CHANNEL_KEYS.map((k) => (
              <option key={k} value={k}>
                {ELIGIBILITY_CHANNELS[k]}
              </option>
            ))}
          </select>
        </FormField>
        <p className="text-xs text-zinc-500">{CONSENT_TEXT[channel ? (s.sourceType === "CONTACT" ? "VERIFIED" : "NOT_AVAILABLE") : "NOT_CHECKED"].text}</p>
      </section>
      {editable && (
        <div className={`${CARD} flex flex-wrap items-end gap-3`}>
          <FormField label="Change note (optional)" htmlFor="d-note">
            <input id="d-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${textInputClass()} min-w-[18rem]`} />
          </FormField>
          <Button variant="secondary" disabled={issues.length > 0} onClick={() => onPreviewDraft(draft)}>
            Preview these rules
          </Button>
          <Button
            isLoading={busy}
            loadingLabel="Saving…"
            disabled={issues.length > 0}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await send<{ changed: boolean; versionNumber: number }>(`/api/v1/sales-marketing/segments/${s.id}/definition`, "PUT", { ...draft, changeNote: note, version: s.version });
                setMsg({ ok: true, text: r.changed ? `Saved as definition version ${r.versionNumber}. Refresh the segment to get a snapshot of it.` : "Nothing changed." });
                setNote("");
                onSaved();
              } catch (e) {
                setMsg({ ok: false, text: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save rules
          </Button>
          {issues.length > 0 && <span className="text-sm text-red-600">Fix the {issues.length} problem{issues.length > 1 ? "s" : ""} above first.</span>}
          {msg && <span className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span>}
        </div>
      )}
      <section className={CARD}>
        <h3 className="mb-2 font-medium">Definition versions</h3>
        <ul className="space-y-2 text-sm">
          {s.versions.map((v) => (
            <li key={v.versionNumber} className="border-b border-zinc-100 pb-2 last:border-0 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={v.versionNumber === s.currentVersionNumber ? "indigo" : "zinc"}>v{v.versionNumber}</Badge>
                <span className="text-xs text-zinc-500">
                  {fmtDateTime(v.createdAt)} · {v.createdBy}
                  {v.eligibilityChannel ? ` · channel ${ELIGIBILITY_CHANNELS[v.eligibilityChannel as keyof typeof ELIGIBILITY_CHANNELS] ?? v.eligibilityChannel}` : ""}
                </span>
                {v.changeNote && <span className="text-xs italic">“{v.changeNote}”</span>}
              </div>
              {s.segmentType === "DYNAMIC" && <DefinitionSummary source={s.sourceType} criteria={asCriteria(v.criteria)} lookups={lookups} empty="Every record." />}
              {asCriteria(v.exclusionCriteria).groups.length > 0 && (
                <div className="mt-1 text-xs text-zinc-500">
                  Excluding: <DefinitionSummary source={s.sourceType} criteria={asCriteria(v.exclusionCriteria)} lookups={lookups} empty="" />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Preview tab ─────────────────────────────────────────────────────

interface Preview {
  computedAt: string;
  usingDraft: boolean;
  counts: { matched: number; excluded: number; ineligible: number; members: number };
  consentCheck: string;
  show: string;
  rows: (RecordRow & { outcome: string | null; reason: string | null })[];
  meta: { page: number; totalPages: number; totalCount: number };
}

function RecordTable({ rows, extra }: { rows: RecordRow[]; extra?: (r: RecordRow) => React.ReactNode }) {
  if (!rows.length) return <p className="text-sm text-zinc-500">No records.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3">Organisation</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1 pr-3">Owner</th>
            <th className="py-1 pr-3">Location</th>
            {extra && <th className="py-1 pr-3" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1 pr-3">{r.href ? <Link href={r.href} className="text-indigo-600 hover:underline dark:text-indigo-400">{r.name}</Link> : <span className="text-zinc-500">{r.name}</span>}</td>
              <td className="py-1 pr-3">{r.organization ?? "—"}</td>
              <td className="py-1 pr-3">{r.status ?? "—"}</td>
              <td className="py-1 pr-3">{r.owner ?? "—"}</td>
              <td className="py-1 pr-3">{r.location ?? "—"}</td>
              {extra && <td className="py-1 pr-3">{extra(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-zinc-500">
        Page {page} of {totalPages}
      </span>
      <Button size="xs" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

function PreviewTab({ s, draft }: { s: SegmentDetail; draft: { criteria: SegmentCriteria; exclusionCriteria: SegmentCriteria; eligibilityChannel: string | null } | null }) {
  const [show, setShow] = useState<"members" | "excluded" | "ineligible">("members");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useCallback(
    (p: number, which: typeof show) => {
      setLoading(true);
      setError(null);
      send<Preview>(`/api/v1/sales-marketing/segments/${s.id}/preview`, "POST", { ...(draft ? { draft } : {}), show: which, page: p })
        .then((d) => setData(d))
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    },
    [s.id, draft]
  );
  useEffect(() => {
    let alive = true;
    send<Preview>(`/api/v1/sales-marketing/segments/${s.id}/preview`, "POST", { ...(draft ? { draft } : {}), show: "members", page: 1 })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [s.id, draft]);
  const consent = CONSENT_TEXT[data?.consentCheck ?? s.consentCheck];
  return (
    <div className="space-y-3">
      <div className={`${CARD} space-y-2`}>
        <p className="text-sm">
          <Badge tone="indigo">Live preview</Badge> <span className="text-zinc-600 dark:text-zinc-300">{draft ? "of the unsaved rules from the Definition tab" : `of definition v${s.currentVersionNumber}`}, counted now with your access. It is not a snapshot and nothing is saved or sent.</span>
        </p>
        {consent && <p className="text-xs text-zinc-500">{consent.text}</p>}
        {error && <ErrorState message={error} onRetry={() => run(page, show)} />}
        {data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Matching", data.counts.matched, null],
                ["Members", data.counts.members, "members"],
                ["Excluded", data.counts.excluded, "excluded"],
                ["Not eligible", data.counts.ineligible, "ineligible"],
              ] as const
            ).map(([label, n, key]) => (
              <button
                key={label}
                type="button"
                disabled={!key}
                onClick={() => key && (setShow(key), setPage(1), run(1, key))}
                className={`rounded-md border p-2 text-left ${key && show === key ? "border-indigo-500" : "border-zinc-200 dark:border-zinc-700"}`}
              >
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="text-lg font-semibold tabular-nums">{fmtCount(n)}</div>
              </button>
            ))}
          </div>
        )}
        {data && <p className="text-xs text-zinc-500">Counted {fmtDateTime(data.computedAt)}.</p>}
      </div>
      <div className={CARD}>
        {(loading || error === null) && !data ? (
          <LoadingState />
        ) : data ? (
          <div className="space-y-2">
            <RecordTable rows={data.rows} extra={show === "members" ? undefined : (r) => <span className="text-xs text-zinc-500">{REASON_LABELS[(r as Preview["rows"][number]).reason ?? ""] ?? ""}</span>} />
            <Pager page={data.meta.page} totalPages={data.meta.totalPages} onPage={(p) => (setPage(p), run(p, show))} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Members tab ─────────────────────────────────────────────────────

interface MemberRow extends RecordRow {
  memberId: string;
  reason: string | null;
  source: string;
  addedAt: string;
  addedBy: string;
  removedAt: string | null;
  removedBy: string | null;
}

function MembersTab({ s, onChanged }: { s: SegmentDetail; onChanged: () => void }) {
  const kinds = s.segmentType === "STATIC" ? (["INCLUDED", "EXCLUDED"] as const) : (["EXCLUDED"] as const);
  const [kind, setKind] = useState<"INCLUDED" | "EXCLUDED">(kinds[0]);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState(false);
  const [list, setList] = useState<{ data: MemberRow[]; meta: { page: number; totalPages: number; totalCount: number } } | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/sales-marketing/segments/${s.id}/members?kind=${kind}&page=${page}${history ? "&history=true" : ""}`, { headers: { "x-toast": "off" } })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) return setListError("Couldn't load members.");
        setListError(null);
        setList(await r.json());
      })
      .catch(() => alive && setListError("Couldn't load members."));
    return () => {
      alive = false;
    };
  }, [s.id, kind, page, history, tick]);

  const [search, setSearch] = useState("");
  const [found, setFound] = useState<(RecordRow & { membership: string | null })[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const editable = s.canEdit && s.status !== "ARCHIVED";
  const searchSeq = useRef(0);
  useEffect(() => {
    if (!editable) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(() => {
      fetch(`/api/v1/sales-marketing/segments/${s.id}/candidates?search=${encodeURIComponent(search)}`, { headers: { "x-toast": "off" } })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => seq === searchSeq.current && setFound(b.data ?? []))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [s.id, search, editable, tick]);

  const refresh = () => {
    setTick((t) => t + 1);
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className={`${CARD} flex flex-wrap items-center gap-3`}>
        {kinds.map((k) => (
          <Button key={k} size="xs" variant={kind === k ? "primary" : "secondary"} onClick={() => (setKind(k), setPage(1))}>
            {k === "INCLUDED" ? `Members (${s.memberCounts.included})` : `Excluded by hand (${s.memberCounts.excluded})`}
          </Button>
        ))}
        <label className="flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" checked={history} onChange={(e) => (setHistory(e.target.checked), setPage(1))} /> Show removed (history)
        </label>
        {s.segmentType === "DYNAMIC" && <span className="text-xs text-zinc-500">Dynamic members come from the rules — here you can only exclude specific records.</span>}
      </div>
      <div className={CARD}>
        {listError ? (
          <ErrorState message={listError} onRetry={() => setTick((t) => t + 1)} />
        ) : !list ? (
          <LoadingState />
        ) : (
          <div className="space-y-2">
            <RecordTable
              rows={list.data}
              extra={(r) => {
                const m = r as MemberRow;
                return (
                  <div className="text-xs text-zinc-500">
                    {m.removedAt ? `Removed ${fmtDateTime(m.removedAt)} by ${m.removedBy}` : `Added ${fmtDateTime(m.addedAt)} by ${m.addedBy}`}
                    {m.reason ? ` · ${m.reason}` : ""}
                    {editable && !m.removedAt && (
                      <button
                        type="button"
                        className="ml-2 text-red-600 hover:underline"
                        onClick={async () => {
                          await send(`/api/v1/sales-marketing/segments/${s.id}/members`, "DELETE", { recordIds: [m.id], kind }).catch((e) => setMsg((e as Error).message));
                          refresh();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              }}
            />
            <Pager page={list.meta.page} totalPages={list.meta.totalPages} onPage={setPage} />
          </div>
        )}
      </div>
      {editable && (
        <div className={`${CARD} space-y-2`}>
          <h3 className="font-medium">{kind === "INCLUDED" ? "Add members" : "Exclude records by hand"}</h3>
          <input aria-label="Search records" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${sourceLabel(s.sourceType).toLowerCase()} you can see…`} className={`${textInputClass()} max-w-md`} />
          <ul className="max-h-64 overflow-y-auto text-sm">
            {found.map((r) => (
              <li key={r.id} className="flex items-center gap-2 border-b border-zinc-100 py-1 dark:border-zinc-800">
                <input
                  type="checkbox"
                  aria-label={`Pick ${r.name}`}
                  disabled={r.membership === kind}
                  checked={picked.has(r.id)}
                  onChange={(e) => setPicked((p) => {
                    const n = new Set(p);
                    if (e.target.checked) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  })}
                />
                <span>{r.name}</span>
                <span className="text-xs text-zinc-500">{[r.organization, r.location].filter(Boolean).join(" · ")}</span>
                {r.membership && <Badge tone={r.membership === "INCLUDED" ? "green" : "amber"}>{r.membership === "INCLUDED" ? "member" : "excluded"}</Badge>}
              </li>
            ))}
            {!found.length && <li className="py-1 text-zinc-500">No matching records.</li>}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" className={`${textInputClass()} max-w-xs`} />
            <Button
              isLoading={busy}
              disabled={!picked.size}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                try {
                  const r = await send<{ added: number; alreadyPresent: number; rejected: number }>(`/api/v1/sales-marketing/segments/${s.id}/members`, "POST", { recordIds: [...picked], kind, reason });
                  setMsg(`Added ${r.added}${r.alreadyPresent ? `, ${r.alreadyPresent} already there` : ""}${r.rejected ? `, ${r.rejected} refused (not visible to you)` : ""}.`);
                  setPicked(new Set());
                  refresh();
                } catch (e) {
                  setMsg((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {kind === "INCLUDED" ? `Add ${picked.size || ""} selected` : `Exclude ${picked.size || ""} selected`}
            </Button>
            {msg && <span className="text-sm text-zinc-600 dark:text-zinc-300">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Snapshots tab ───────────────────────────────────────────────────

function SnapshotModal({ evaluationId, onClose, canEdit, onChanged }: { evaluationId: string; onClose: () => void; canEdit: boolean; onChanged: () => void }) {
  const { data: e, reload } = useApi<Evaluation & { breakdown: { outcome: string; reason: string | null; count: number }[]; isCurrentVersion: boolean }>(`/api/v1/sales-marketing/segments/evaluations/${evaluationId}`);
  const [outcome, setOutcome] = useState<"INCLUDED" | "EXCLUDED" | "INELIGIBLE">("INCLUDED");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ data: (RecordRow & { reason: string | null })[]; meta: { totalPages: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadable = Boolean(e && e.status === "COMPLETED" && !e.entriesPurged);
  useEffect(() => {
    if (!loadable) return;
    let alive = true;
    fetch(`/api/v1/sales-marketing/segments/evaluations/${evaluationId}/entries?outcome=${outcome}&page=${page}`, { headers: { "x-toast": "off" } })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) return setError("Couldn't load the snapshot's records.");
        setError(null);
        setList(await r.json());
      })
      .catch(() => alive && setError("Couldn't load the snapshot's records."));
    return () => {
      alive = false;
    };
  }, [loadable, evaluationId, outcome, page]);
  const entries = list?.data ?? null;
  const meta = list?.meta ?? null;
  return (
    <Modal open onClose={onClose} title="Snapshot" maxWidthClass="max-w-4xl">
      {!e ? (
        <LoadingState />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <EvaluationBadge status={e.status} /> <span>Definition v{e.versionNumber}</span>
            {!e.isCurrentVersion && <Badge tone="amber">Definition has changed since</Badge>}
            {e.isKept && <Badge tone="indigo">Kept{e.label ? `: ${e.label}` : ""}</Badge>}
          </div>
          <p className="text-xs text-zinc-500">
            Requested {fmtDateTime(e.requestedAt)} by {e.requestedBy} · ran as {e.runAs} · finished {fmtDateTime(e.finishedAt)}
          </p>
          {e.error && <p className="text-red-600">{e.error}</p>}
          {e.status === "COMPLETED" && (
            <div className="flex flex-wrap gap-2">
              {(["INCLUDED", "EXCLUDED", "INELIGIBLE"] as const).map((o) => (
                <Button key={o} size="xs" variant={outcome === o ? "primary" : "secondary"} onClick={() => (setOutcome(o), setPage(1))}>
                  {o === "INCLUDED" ? `Members (${fmtCount(e.memberCount)})` : o === "EXCLUDED" ? `Excluded (${fmtCount(e.excludedCount)})` : `Not eligible (${fmtCount(e.ineligibleCount)})`}
                </Button>
              ))}
            </div>
          )}
          {e.breakdown.filter((b) => b.reason).length > 0 && (
            <p className="text-xs text-zinc-500">
              {e.breakdown
                .filter((b) => b.reason)
                .map((b) => `${REASON_LABELS[b.reason!] ?? b.reason}: ${b.count}`)
                .join(" · ")}
            </p>
          )}
          {e.entriesPurged ? (
            <p className="text-zinc-500">The member list of this old snapshot was removed by the retention rule; only its counts remain.</p>
          ) : e.status === "COMPLETED" ? (
            error ? (
              <p className="text-red-600">{error}</p>
            ) : !entries ? (
              <LoadingState />
            ) : (
              <>
                <RecordTable rows={entries} extra={outcome === "INCLUDED" ? undefined : (r) => <span className="text-xs text-zinc-500">{REASON_LABELS[(r as RecordRow & { reason: string | null }).reason ?? ""] ?? ""}</span>} />
                {meta && <Pager page={page} totalPages={meta.totalPages} onPage={setPage} />}
              </>
            )
          ) : null}
          {canEdit && e.status === "COMPLETED" && !e.entriesPurged && (
            <div className="flex justify-end">
              <Button
                size="xs"
                variant="secondary"
                onClick={async () => {
                  await send(`/api/v1/sales-marketing/segments/evaluations/${evaluationId}/keep`, "PATCH", { keep: !e.isKept });
                  reload();
                  onChanged();
                }}
              >
                {e.isKept ? "Stop keeping" : "Keep this snapshot"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SnapshotsTab({ s, onChanged }: { s: SegmentDetail; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={CARD}>
      <p className="mb-2 text-xs text-zinc-500">Each refresh stores a snapshot: the exact records in the segment at that moment, for the definition version shown. The newest 5 snapshots, kept ones and ones pinned by a campaign keep their member lists; older ones keep only their counts.</p>
      {!s.evaluations.length ? (
        <p className="text-sm text-zinc-500">No snapshots yet. Use “Refresh now”.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1 pr-3">Requested</th>
              <th className="py-1 pr-3">Version</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Members</th>
              <th className="py-1 pr-3">Excluded / not eligible</th>
              <th className="py-1 pr-3">By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.evaluations.map((e) => (
              <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-3 whitespace-nowrap">{fmtDateTime(e.requestedAt)}</td>
                <td className="py-1 pr-3">v{e.versionNumber}</td>
                <td className="py-1 pr-3">
                  <EvaluationBadge status={e.status} /> {e.isKept && <Badge tone="indigo">Kept</Badge>}
                  {e.error && <div className="text-xs text-red-600">{e.error}</div>}
                </td>
                <td className="py-1 pr-3 tabular-nums">{fmtCount(e.memberCount)}</td>
                <td className="py-1 pr-3 tabular-nums">
                  {fmtCount(e.excludedCount)} / {fmtCount(e.ineligibleCount)}
                </td>
                <td className="py-1 pr-3 text-xs">{e.trigger === "NIGHTLY" ? "Nightly" : e.requestedBy}</td>
                <td className="py-1">
                  <button type="button" className="text-indigo-600 hover:underline" onClick={() => setOpen(e.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <SnapshotModal evaluationId={open} onClose={() => setOpen(null)} canEdit={s.canEdit} onChanged={onChanged} />}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Created",
  DEFINITION_CHANGED: "Rules changed",
  OWNER_CHANGED: "Owner changed",
  ACTIVATE: "Activated",
  PAUSE: "Paused",
  ARCHIVE: "Archived",
  MEMBERS_ADDED: "Members added",
  MEMBERS_REMOVED: "Members removed",
  EXCLUSIONS_ADDED: "Excluded by hand",
  EXCLUSIONS_REMOVED: "Hand exclusions removed",
  EVALUATION_REQUESTED: "Refresh requested",
  EVALUATION_COMPLETED: "Refresh completed",
  EVALUATION_FAILED: "Refresh failed",
  SNAPSHOT_KEPT: "Snapshot kept",
  SNAPSHOT_RELEASED: "Snapshot released",
  USED_BY_CAMPAIGN: "Added to a campaign",
  DUPLICATED_FROM: "Duplicated from another segment",
};

export function SegmentDetailClient({ initial, permissions }: { initial: SegmentDetail; permissions: { edit: boolean; archive: boolean; create: boolean } }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [tab, setTab] = useState<Tab>("Definition");
  const [draft, setDraft] = useState<{ criteria: SegmentCriteria; exclusionCriteria: SegmentCriteria; eligibilityChannel: string | null } | null>(null);
  const [confirm, setConfirm] = useState<SegmentActionKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dup, setDup] = useState(false);
  const lookups = useFieldOptions(s.sourceType);
  const reload = useCallback(async () => {
    const r = await fetch(`/api/v1/sales-marketing/segments/${s.id}`, { headers: { "x-toast": "off" } });
    if (r.ok) setS((await r.json()).data);
  }, [s.id]);

  // Poll while an evaluation is queued / running.
  const running = s.evaluations.some((e) => e.status === "QUEUED" || e.status === "RUNNING");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [running, reload]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sm = s.summary;
  const actions = (Object.keys(SEGMENT_ACTIONS) as SegmentActionKey[]).filter((a) => (SEGMENT_ACTIONS[a].from as readonly string[]).includes(s.status) && (a === "archive" ? permissions.archive : permissions.edit));

  return (
    <div className="space-y-4">
      <div className={`${CARD} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentStatusBadge status={s.status} />
          <Badge tone="zinc">{SEGMENT_TYPES[s.segmentType].label}</Badge>
          <Badge tone="zinc">{sourceLabel(s.sourceType)}</Badge>
          <span className="text-xs text-zinc-500">
            Definition v{s.currentVersionNumber} · owner {s.owner.fullName} · {SEGMENT_REFRESH[s.refreshSchedule]}
          </span>
        </div>
        {s.description && <p className="text-sm text-zinc-700 dark:text-zinc-300">{s.description}</p>}
        {s.purpose && <p className="text-sm text-zinc-500">Purpose: {s.purpose}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-zinc-500">Members in the last snapshot</div>
            <div className="text-2xl font-semibold tabular-nums">{fmtCount(sm.memberCount)}</div>
            <div className="text-xs text-zinc-500">{sm.lastEvaluatedAt ? `${fmtDateTime(sm.lastEvaluatedAt)} · v${sm.lastCompletedVersion}` : "Never evaluated"}</div>
          </div>
          <div className="space-y-1 text-sm">
            <div>
              Last refresh: <EvaluationBadge status={sm.lastEvaluationStatus} />
            </div>
            {sm.lastEvaluationStatus === "FAILED" && <p className="text-xs text-red-600">{sm.lastError} {sm.lastEvaluatedAt ? "The count shown is from the last successful snapshot." : ""}</p>}
            {sm.definitionChangedSinceEvaluation && <p className="text-xs text-amber-700 dark:text-amber-400">The rules changed after this snapshot — refresh to see the current audience.</p>}
            {sm.membersChangedSinceEvaluation && <p className="text-xs text-amber-700 dark:text-amber-400">Members changed after this snapshot — refresh to update it.</p>}
            {running && <p className="text-xs text-indigo-600">Refreshing in the background…</p>}
          </div>
          <div className="text-xs text-zinc-500">{CONSENT_TEXT[s.consentCheck]?.text}</div>
        </div>
        {s.campaigns.length > 0 && (
          <p className="text-xs text-zinc-500">
            Used by:{" "}
            {s.campaigns.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <Link href={`/sales-marketing/campaigns/${c.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {c.code}
                </Link>{" "}
                ({c.role === "INCLUDE" ? "include" : "exclude"}
                {c.pinnedEvaluationId ? ", pinned" : ""})
              </span>
            ))}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {permissions.edit && s.status !== "ARCHIVED" && (
            <Button size="sm" isLoading={busy && !confirm} loadingLabel="Requesting…" disabled={running} onClick={() => act(() => send(`/api/v1/sales-marketing/segments/${s.id}/evaluations`, "POST", { idempotencyKey: `eval-${crypto.randomUUID()}` }))}>
              {running ? "Refreshing…" : "Refresh now"}
            </Button>
          )}
          {permissions.edit && s.status !== "ARCHIVED" && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          )}
          {actions.map((a) => (
            <Button key={a} size="sm" variant={a === "archive" ? "danger" : "secondary"} onClick={() => setConfirm(a)}>
              {SEGMENT_ACTIONS[a].label}
            </Button>
          ))}
          {permissions.create && (
            <Button size="sm" variant="secondary" onClick={() => setDup(true)}>
              Duplicate
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "text-zinc-500"}`}>
            {t}
            {t === "Preview" && draft ? " (unsaved rules)" : ""}
          </button>
        ))}
      </div>

      {tab === "Definition" && (
        <DefinitionTab
          key={s.currentVersionNumber}
          s={s}
          lookups={lookups}
          onSaved={() => (setDraft(null), reload())}
          onPreviewDraft={(d) => {
            setDraft(d);
            setTab("Preview");
          }}
        />
      )}
      {tab === "Preview" && (
        <div className="space-y-2">
          {draft && (
            <Button size="xs" variant="secondary" onClick={() => setDraft(null)}>
              Preview the saved rules instead
            </Button>
          )}
          <PreviewTab key={draft ? "draft" : `v${s.currentVersionNumber}`} s={s} draft={draft} />
        </div>
      )}
      {tab === "Members" && <MembersTab s={s} onChanged={reload} />}
      {tab === "Snapshots" && <SnapshotsTab s={s} onChanged={reload} />}
      {tab === "History" && (
        <ul className={`${CARD} space-y-1 text-sm`}>
          {s.events.map((e) => (
            <li key={e.id}>
              <span className="text-xs text-zinc-500">{fmtDateTime(e.at)}</span> · {EVENT_LABELS[e.type] ?? e.type} · {e.by}
              {e.comment ? <span className="text-zinc-500"> — {e.comment}</span> : null}
            </li>
          ))}
          {!s.events.length && <li className="text-zinc-500">No history yet.</li>}
        </ul>
      )}

      {confirm && (
        <ConfirmModal
          open
          title={`${SEGMENT_ACTIONS[confirm].label} segment?`}
          message={confirm === "archive" ? "An archived segment can't be edited, refreshed or used in new campaigns. Its snapshots stay for history." : confirm === "activate" ? "Active segments can be used in campaigns and refresh nightly if set to." : "A paused segment can't be added to campaigns and doesn't refresh nightly."}
          confirmLabel={SEGMENT_ACTIONS[confirm].label}
          isDangerous={confirm === "archive"}
          isBusy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => act(() => send(`/api/v1/sales-marketing/segments/${s.id}/actions/${confirm}`, "POST", {})).then(() => setConfirm(null))}
        />
      )}
      {editing && <EditDetailsModal s={s} onClose={() => setEditing(false)} onSaved={(n) => (setS(n), setEditing(false))} />}
      {dup && <DuplicateModal s={s} onClose={() => setDup(false)} onDone={(id) => router.push(`/sales-marketing/segments/${id}`)} />}
    </div>
  );
}

function EditDetailsModal({ s, onClose, onSaved }: { s: SegmentDetail; onClose: () => void; onSaved: (s: SegmentDetail) => void }) {
  const { data: opts } = useApi<{ owners: { id: string; label: string }[] }>("/api/v1/sales-marketing/segments/options");
  const [v, setV] = useState({ name: s.name, description: s.description ?? "", purpose: s.purpose ?? "", ownerUserId: s.owner.id, refreshSchedule: s.refreshSchedule });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owners = opts?.owners ?? [];
  return (
    <Modal open onClose={onClose} title="Edit segment details" maxWidthClass="max-w-lg">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onSaved(await send<SegmentDetail>(`/api/v1/sales-marketing/segments/${s.id}`, "PATCH", { ...v, version: s.version }));
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <FormField label="Name" htmlFor="e-name" required>
          <input id="e-name" required maxLength={200} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Description" htmlFor="e-desc">
          <textarea id="e-desc" rows={2} maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Business purpose" htmlFor="e-purpose">
          <input id="e-purpose" maxLength={1000} value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Owner" htmlFor="e-owner" required>
          <SearchableSelect id="e-owner" required value={v.ownerUserId} onChange={(ownerUserId) => setV({ ...v, ownerUserId })} options={owners.some((o) => o.id === s.owner.id) ? owners : [{ id: s.owner.id, label: s.owner.fullName }, ...owners]} placeholder="Search people…" />
        </FormField>
        {s.segmentType === "DYNAMIC" && (
          <FormField label="Refresh" htmlFor="e-refresh">
            <select id="e-refresh" value={v.refreshSchedule} onChange={(e) => setV({ ...v, refreshSchedule: e.target.value as "MANUAL" | "NIGHTLY" })} className={textInputClass()}>
              <option value="MANUAL">{SEGMENT_REFRESH.MANUAL}</option>
              <option value="NIGHTLY">{SEGMENT_REFRESH.NIGHTLY}</option>
            </select>
          </FormField>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DuplicateModal({ s, onClose, onDone }: { s: SegmentDetail; onClose: () => void; onDone: (id: string) => void }) {
  const [code, setCode] = useState(`${s.code}-COPY`.slice(0, 40));
  const [name, setName] = useState(`${s.name} (copy)`.slice(0, 200));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Duplicate segment">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onDone((await send<{ id: string }>(`/api/v1/sales-marketing/segments/${s.id}/duplicate`, "POST", { code, name })).id);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Copies the current rules and the hand-picked members / exclusions into a new draft segment owned by you. Snapshots aren&apos;t copied.</p>
        <FormField label="Code" htmlFor="dup-code" required>
          <input id="dup-code" required maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Name" htmlFor="dup-name" required>
          <input id="dup-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={textInputClass()} />
        </FormField>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Copying…">
            Duplicate
          </Button>
        </div>
      </form>
    </Modal>
  );
}

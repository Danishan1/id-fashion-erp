"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmColumnPicker } from "@/components/crm/CrmColumnPicker";
import { formatCustomFieldValue } from "@/components/crm/CrmCustomFields";
import { CrmFilterBar, crmFilterKeys } from "@/components/crm/CrmFilterBar";
import { AssignOwnerModal } from "@/components/crm/CrmRecordDialogs";
import { crmRequest, type CrmApiError } from "@/components/crm/crm-api";
import { useCrmListState } from "@/components/crm/useCrmListState";
import type { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { isClosedStatus, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { CloseDate, OpportunityStatusBadge, opportunityValue } from "./OpportunityBadges";
import { ChangeStageModal } from "./OpportunityDialogs";
import type { OpportunityMetaDto, OpportunityPermissions, OpportunityRowDto, TransitionCheckDto, UserRefDto } from "./opportunity-types";
import { useOpportunityFilters } from "./useOpportunityFilters";

const OPP_API = "/api/v1/crm/opportunities";
const PER_STAGE = 20;
export const CONFLICT_MESSAGE = "This opportunity was updated by another user. Please refresh and try again.";

export type BoardCardDto = OpportunityRowDto & { customFields?: Record<string, unknown> | null };
export interface BoardColumnDto {
  id: string;
  name: string;
  sortOrder: number;
  probability: number | null;
  isDefault: boolean;
  archived: boolean;
  requiredFields: string[];
  count: number;
  values: { currencyCode: string | null; total: number; weighted: number; average: number | null }[];
  records: BoardCardDto[];
  hasMore: boolean;
}
export interface BoardDto {
  pipeline: { id: string; name: string; isDefault: boolean; archivedAt: string | null };
  stages: BoardColumnDto[];
}

interface CardField {
  key: string;
  header: string;
  render: (o: BoardCardDto) => ReactNode;
}

const BASE_CARD_FIELDS: CardField[] = [
  { key: "company", header: "Company", render: (o) => o.crmCompany?.name ?? null },
  { key: "contact", header: "Contact", render: (o) => o.crmContact?.fullName ?? null },
  { key: "amount", header: "Value", render: (o) => opportunityValue(o.amount, o.currencyCode) },
  { key: "probability", header: "Probability", render: (o) => (o.probability !== null ? `${o.probability}%` : null) },
  { key: "expectedCloseDate", header: "Expected close", render: (o) => (o.expectedCloseDate ? <CloseDate value={o.expectedCloseDate} status={o.status} /> : null) },
  { key: "owner", header: "Owner", render: (o) => (o.owner ? <OwnerName owner={o.owner} inactive={o.ownerInactive} /> : "Unassigned") },
  {
    key: "tags",
    header: "Tags",
    render: (o) =>
      o.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {o.tags.map((t) => (
            <CrmBadge key={t.id} label={t.name} />
          ))}
        </span>
      ) : null,
  },
  { key: "status", header: "Status", render: (o) => (o.status !== "OPEN" ? <OpportunityStatusBadge status={o.status} /> : null) },
  { key: "source", header: "Source", render: (o) => o.source?.name ?? null },
  { key: "lastActivityAt", header: "Last activity", render: (o) => (o.lastActivityAt ? <ClientDateTime value={o.lastActivityAt} /> : null) },
  { key: "createdAt", header: "Created", render: (o) => <ClientDateTime value={o.createdAt} mode="date" /> },
];
export const DEFAULT_CARD_FIELDS = ["company", "contact", "amount", "probability", "expectedCloseDate", "owner", "tags", "status"];

type Move = { record: BoardCardDto; fromStageId: string; toStageId: string; index: number };
type Notice =
  | { kind: "blocked"; record: BoardCardDto; stageName: string; reasons: TransitionCheckDto["reasons"]; missingFields: TransitionCheckDto["missingFields"] }
  | { kind: "conflict"; record: BoardCardDto }
  | { kind: "error"; record: BoardCardDto; message: string };
type Dialog = { kind: "stage"; record: BoardCardDto } | { kind: "assign"; record: BoardCardDto } | { kind: "archive"; record: BoardCardDto } | null;

const money = (values: BoardColumnDto["values"], pick: "total" | "weighted" | "average") =>
  values
    .filter((v) => v[pick] !== null)
    .map((v) => opportunityValue(v[pick], v.currencyCode))
    .join(" + ");

/** Board columns after taking `id` out of its column (count adjusted). */
function withoutCard(stages: BoardColumnDto[], id: string) {
  return stages.map((s) => (s.records.some((r) => r.id === id) ? { ...s, records: s.records.filter((r) => r.id !== id), count: Math.max(0, s.count - 1) } : s));
}
function withCard(stages: BoardColumnDto[], stageId: string, record: BoardCardDto, index = 0) {
  return stages.map((s) => {
    if (s.id !== stageId) return s;
    const records = [...s.records];
    records.splice(Math.min(index, records.length), 0, record);
    return { ...s, records, count: s.count + 1 };
  });
}

/** Turns a refused stage change into what the board shows (the server decides; nothing is re-validated here). */
export function moveFailureNotice(error: CrmApiError, record: BoardCardDto, stageName: string): Notice {
  if (error.code === "CRM_STAGE_TRANSITION_BLOCKED") {
    const d = error.details ?? {};
    return { kind: "blocked", record, stageName, reasons: (d.reasons as TransitionCheckDto["reasons"]) ?? [], missingFields: (d.missingFields as TransitionCheckDto["missingFields"]) ?? [] };
  }
  if (error.code === "RECORD_VERSION_CONFLICT" || error.status === 409) return { kind: "conflict", record };
  return { kind: "error", record, message: error.message };
}

/**
 * Opportunity Board (Phase 08): one pipeline's stages as columns, the same
 * server-side filters as the List, per-column paging and backend totals.
 * Drag and drop calls the Phase 07 stage endpoint (POST /opportunities/{id}/stage,
 * with the record's version) — the server is the only judge of whether a move
 * is allowed. The card moves optimistically and is put back exactly where it
 * was when the server refuses (rules, required fields, version conflict,
 * network error); after a successful move the board is reloaded so counts and
 * values come from the server again.
 */
export function OpportunityBoardClient({
  permissions,
  meta,
  users,
  preferences,
}: {
  permissions: OpportunityPermissions;
  meta: OpportunityMetaDto;
  users: UserRefDto[];
  preferences: ReturnType<typeof useCrmPreferences>;
}) {
  const router = useRouter();
  const { prefs, setPreference } = preferences;
  const activePipelines = meta.pipelines.filter((p) => p.isActive && !p.archivedAt);
  const [chosenPipelineId, setChosenPipelineId] = useState<string | null>(null);
  const remembered = activePipelines.find((p) => p.id === prefs["opportunities.board.pipelineId"])?.id;
  const pipelineId = chosenPipelineId ?? remembered ?? activePipelines.find((p) => p.isDefault)?.id ?? activePipelines[0]?.id ?? null;

  const { filters } = useOpportunityFilters({ meta, users, boardPipelineId: pipelineId });
  const listState = useCrmListState(crmFilterKeys(filters));
  const [searchDraft, setSearchDraft] = useState(listState.search);

  const customFieldDefs = useMemo(() => meta.customFields.filter((d) => d.isActive), [meta.customFields]);
  const cardFieldOptions: CardField[] = useMemo(
    () => [
      ...BASE_CARD_FIELDS,
      ...customFieldDefs.map((d) => ({
        key: `cf:${d.key}`,
        header: d.label,
        render: (o: BoardCardDto) => {
          const v = formatCustomFieldValue(d, o.customFields?.[d.key]);
          return v === "—" ? null : v;
        },
      })),
    ],
    [customFieldDefs]
  );
  const cardFieldKeys = (prefs["opportunities.board.cardFields"] ?? DEFAULT_CARD_FIELDS).filter((k) => cardFieldOptions.some((f) => f.key === k));
  const cardFields = cardFieldOptions.filter((f) => cardFieldKeys.includes(f.key));

  // ── Loading (stale-while-revalidate: the board stays visible while it refreshes) ──
  const queryParams = new URLSearchParams({ perStage: String(PER_STAGE) });
  for (const [k, v] of Object.entries(listState.filters)) if (v) queryParams.set(k, v);
  if (listState.search) queryParams.set("search", listState.search);
  const query = pipelineId ? `/api/v1/crm/pipelines/${pipelineId}/board?${queryParams}` : null;
  const [state, setState] = useState<{ query: string; board: BoardDto | null; error: string | null } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    crmRequest<BoardDto>(query, { toast: "off" }).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { query, board: res.data, error: null } : (s) => ({ query, board: s?.query === query ? s.board : null, error: res.error.message }));
    });
    return () => {
      cancelled = true;
    };
  }, [query, reloadTick]);
  const reload = () => setReloadTick((t) => t + 1);
  const loading = Boolean(query) && state?.query !== query;
  const board = state?.query === query ? state.board : null;
  const loadError = state?.query === query ? state.error : null;

  const setStages = (fn: (stages: BoardColumnDto[]) => BoardColumnDto[]) => setState((s) => (s?.board ? { ...s, board: { ...s.board, stages: fn(s.board.stages) } } : s));

  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const loadMore = async (column: BoardColumnDto) => {
    if (!query) return;
    setLoadingMore(column.id);
    const res = await crmRequest<BoardDto>(`${query}&stageId=${column.id}&offset=${column.records.length}`, { toast: "off" });
    setLoadingMore(null);
    if (!res.ok) return toast.error(res.error.message);
    const next = res.data.stages[0];
    if (!next) return;
    setStages((stages) =>
      stages.map((s) => (s.id === column.id ? { ...s, records: [...s.records, ...next.records.filter((r) => !s.records.some((x) => x.id === r.id))], hasMore: next.hasMore, count: next.count } : s))
    );
  };

  // ── Drag and drop ──
  const [dragging, setDragging] = useState<{ id: string; fromStageId: string } | null>(null);
  const [overStageId, setOverStageId] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);

  const rollback = (m: Move) => setStages((stages) => withCard(withoutCard(stages, m.record.id), m.fromStageId, m.record, m.index));

  const moveCard = async (recordId: string, fromStageId: string, toStageId: string) => {
    if (!board || fromStageId === toStageId || pending.has(recordId)) return;
    const from = board.stages.find((s) => s.id === fromStageId);
    const to = board.stages.find((s) => s.id === toStageId);
    const index = from?.records.findIndex((r) => r.id === recordId) ?? -1;
    if (!from || !to || index < 0) return;
    const record = from.records[index];
    const move: Move = { record, fromStageId, toStageId, index };
    // Optimistic: show the card in its new column right away (marked as saving).
    setStages((stages) => withCard(withoutCard(stages, recordId), toStageId, { ...record, stageId: toStageId, stage: record.stage ? { ...record.stage, id: to.id, name: to.name } : record.stage }));
    setPending((p) => new Set(p).add(recordId));
    const res = await crmRequest(`${OPP_API}/${recordId}/stage`, { method: "POST", body: { stageId: toStageId, pipelineId: board.pipeline.id, version: record.version }, toast: "off" });
    setPending((p) => {
      const n = new Set(p);
      n.delete(recordId);
      return n;
    });
    if (!res.ok) {
      rollback(move);
      setNotice(moveFailureNotice(res.error, record, to.name));
      return;
    }
    toast.success(`Moved "${record.name}" to ${to.name}.`);
    reload();
  };

  // ── Card actions ──
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const done = () => {
    setDialog(null);
    reload();
  };
  const archive = async (record: BoardCardDto) => {
    setBusy(true);
    const res = await crmRequest(`${OPP_API}/${record.id}/archive`, { method: "POST", successMessage: "Opportunity archived." });
    setBusy(false);
    if (res.ok) done();
  };
  const cardActions = (o: BoardCardDto): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [{ label: "Open", onClick: () => router.push(`/crm/opportunities/${o.id}`) }];
    if (permissions.edit) {
      const closed = isClosedStatus(o.status as OpportunityStatus);
      items.push(
        { label: "Edit", onClick: () => router.push(`/crm/opportunities/${o.id}/edit`), disabled: closed },
        { label: "Change stage", onClick: () => setDialog({ kind: "stage", record: o }), disabled: closed },
        { label: "Assign owner", onClick: () => setDialog({ kind: "assign", record: o }) },
        { label: "Archive", onClick: () => setDialog({ kind: "archive", record: o }), danger: true }
      );
    }
    return items;
  };

  const [mobileStageId, setMobileStageId] = useState<string | null>(null);

  if (!activePipelines.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        There is no active pipeline yet.{" "}
        {permissions.settings ? (
          <Link href="/crm/settings?tab=pipelines" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Set one up
          </Link>
        ) : (
          "Ask a CRM administrator to set one up."
        )}
      </div>
    );
  }

  const stages = board?.stages ?? [];
  const totalCount = stages.reduce((n, s) => n + s.count, 0);
  const totals = new Map<string | null, { total: number; weighted: number }>();
  for (const s of stages)
    for (const v of s.values) {
      const t = totals.get(v.currencyCode) ?? { total: 0, weighted: 0 };
      totals.set(v.currencyCode, { total: t.total + v.total, weighted: t.weighted + v.weighted });
    }
  const totalValues = [...totals.entries()].map(([currencyCode, t]) => ({ currencyCode, total: Math.round(t.total * 100) / 100, weighted: Math.round(t.weighted * 100) / 100, average: null }));
  const mobileStage = stages.find((s) => s.id === mobileStageId)?.id ?? stages[0]?.id;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="board-pipeline">
          Pipeline
        </label>
        <select
          id="board-pipeline"
          value={pipelineId ?? ""}
          onChange={(e) => {
            setChosenPipelineId(e.target.value);
            setPreference("opportunities.board.pipelineId", e.target.value);
            // Stage filters belong to the previous pipeline.
            if (listState.filters.stageIds) listState.applyFilters({ ...listState.filters, stageIds: "" });
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800"
        >
          {activePipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        <form
          role="search"
          className="flex min-w-[12rem] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            listState.setSearch(searchDraft.trim());
          }}
        >
          <input
            type="search"
            aria-label="Search opportunities"
            value={searchDraft}
            onChange={(e) => {
              setSearchDraft(e.target.value);
              if (!e.target.value && listState.search) listState.setSearch("");
            }}
            placeholder="Search name, number, company, contact, owner…"
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
        </form>
        <CrmColumnPicker label="Card fields" columns={cardFieldOptions.map((f) => ({ key: f.key, header: f.header }))} visibleKeys={cardFieldKeys} onChange={(keys) => setPreference("opportunities.board.cardFields", keys)} />
        <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
          Refresh
        </Button>
        {permissions.create && (
          <Link href="/crm/opportunities/new" className={buttonClasses("primary", "sm")}>
            New opportunity
          </Link>
        )}
      </div>

      <CrmFilterBar definitions={filters} value={listState.filters} onApply={listState.applyFilters} onClearAll={listState.clearFilters} isOpen={listState.isFilterPanelOpen} onToggleOpen={listState.toggleFilterPanel} />

      {board && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300" aria-live="polite">
          <span className="font-medium">{totalCount}</span> {totalCount === 1 ? "opportunity" : "opportunities"}
          {totalValues.length > 0 && (
            <>
              {" · "}value {money(totalValues, "total")} · weighted {money(totalValues, "weighted")}
            </>
          )}
          {!listState.filters.statuses && <span className="text-zinc-400"> · open deals</span>}
        </p>
      )}

      {loading && !board && <div className="rounded-lg border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">Loading board…</div>}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span>Couldn&apos;t load the board: {loadError}</span>
          <Button size="xs" variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {board && totalCount === 0 && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">No opportunities match {listState.search || Object.values(listState.filters).some(Boolean) ? "this search and these filters" : "in this pipeline yet"}.</p>
      )}

      {board && stages.length > 0 && (
        <>
          <div className="md:hidden">
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400" htmlFor="board-mobile-stage">
              Stage
            </label>
            <select id="board-mobile-stage" value={mobileStage ?? ""} onChange={(e) => setMobileStageId(e.target.value)} className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </div>
          <div className={`flex gap-3 overflow-x-auto pb-3 ${loading ? "opacity-70" : ""}`} aria-busy={loading}>
            {stages.map((column) => (
              <section
                key={column.id}
                aria-label={`${column.name} stage`}
                data-stage-id={column.id}
                onDragOver={(e) => {
                  if (!dragging || !permissions.edit) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overStageId !== column.id) setOverStageId(column.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverStageId((s) => (s === column.id ? null : s));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverStageId(null);
                  const id = e.dataTransfer.getData("text/plain") || dragging?.id;
                  const fromStageId = dragging?.fromStageId ?? stages.find((s) => s.records.some((r) => r.id === id))?.id;
                  setDragging(null);
                  if (id && fromStageId) void moveCard(id, fromStageId, column.id);
                }}
                className={`${column.id === mobileStage ? "flex" : "hidden"} w-full shrink-0 flex-col rounded-lg border bg-zinc-50 md:flex md:w-72 dark:bg-zinc-900/60 ${
                  overStageId === column.id ? "border-indigo-400 ring-2 ring-indigo-300 dark:border-indigo-500" : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <header className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100" title={column.name}>
                      {column.name}
                      {column.archived && <span className="ml-1 text-xs font-normal text-amber-600"> (archived)</span>}
                    </h3>
                    <span className="rounded-full bg-zinc-200 px-2 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" aria-label={`${column.count} opportunities`}>
                      {column.count}
                    </span>
                  </div>
                  <dl className="mt-1 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {column.values.length ? (
                      <>
                        <div className="flex justify-between gap-2">
                          <dt>Value</dt>
                          <dd className="text-right font-medium text-zinc-700 dark:text-zinc-200">{money(column.values, "total")}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Weighted</dt>
                          <dd className="text-right">{money(column.values, "weighted")}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Average</dt>
                          <dd className="text-right">{money(column.values, "average")}</dd>
                        </div>
                      </>
                    ) : (
                      <div>No value</div>
                    )}
                    {column.probability !== null && <div>Stage probability {column.probability}%</div>}
                  </dl>
                </header>
                <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 md:max-h-[65vh]">
                  {column.records.map((o) => {
                    const saving = pending.has(o.id);
                    return (
                      <li
                        key={o.id}
                        draggable={permissions.edit && !saving}
                        aria-busy={saving}
                        data-card-id={o.id}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", o.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging({ id: o.id, fromStageId: column.id });
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOverStageId(null);
                        }}
                        className={`rounded-md border border-zinc-200 bg-white p-2.5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-800 ${permissions.edit ? "cursor-grab active:cursor-grabbing" : ""} ${
                          saving ? "opacity-60" : ""
                        } ${dragging?.id === o.id ? "ring-2 ring-indigo-300" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <Link href={`/crm/opportunities/${o.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" draggable={false}>
                              {o.name}
                            </Link>
                            <div className="text-xs text-zinc-400">
                              {o.opportunityNumber}
                              {saving && " · saving…"}
                            </div>
                          </div>
                          <ActionMenu items={cardActions(o)} />
                        </div>
                        {cardFields.length > 0 && (
                          <dl className="mt-1.5 space-y-0.5 text-xs">
                            {cardFields.map((f) => {
                              const value = f.render(o);
                              if (value === null || value === undefined || value === "") return null;
                              return (
                                <div key={f.key} className="flex gap-2">
                                  <dt className="w-24 shrink-0 text-zinc-400">{f.header}</dt>
                                  <dd className="min-w-0 flex-1 break-words text-zinc-700 dark:text-zinc-200">{value}</dd>
                                </div>
                              );
                            })}
                          </dl>
                        )}
                      </li>
                    );
                  })}
                  {column.records.length === 0 && <li className="py-6 text-center text-xs text-zinc-400">{permissions.edit ? "No opportunities — drop one here" : "No opportunities"}</li>}
                </ul>
                {column.hasMore && (
                  <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
                    <Button size="xs" variant="secondary" className="w-full" onClick={() => loadMore(column)} isLoading={loadingMore === column.id}>
                      Load more ({column.count - column.records.length})
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <Modal open={notice !== null} onClose={() => setNotice(null)} title={notice?.kind === "blocked" ? `Can't move to ${notice.stageName}` : notice?.kind === "conflict" ? "Opportunity changed" : "Couldn't move the opportunity"}>
        {notice && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">{notice.record.name}</p>
            {notice.kind === "blocked" && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {notice.reasons
                  .filter((r) => r.code !== "REQUIRED_FIELDS_MISSING")
                  .map((r) => (
                    <p key={r.code + r.message}>{r.message}</p>
                  ))}
                {notice.missingFields.length > 0 && (
                  <>
                    <p className="font-medium">Required before this stage:</p>
                    <ul className="ml-4 list-disc">
                      {notice.missingFields.map((m) => (
                        <li key={m.key}>{m.label}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {notice.kind === "conflict" && <p role="alert">{CONFLICT_MESSAGE}</p>}
            {notice.kind === "error" && <p role="alert">{notice.message}</p>}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">The card was left in its original stage.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setNotice(null)}>
                Close
              </Button>
              {notice.kind === "conflict" ? (
                <Button
                  onClick={() => {
                    setNotice(null);
                    reload();
                  }}
                >
                  Refresh board
                </Button>
              ) : (
                <Link href={`/crm/opportunities/${notice.record.id}`} className={buttonClasses("primary", "sm")}>
                  Open Opportunity
                </Link>
              )}
            </div>
          </div>
        )}
      </Modal>

      {dialog?.kind === "stage" && (
        <ChangeStageModal
          pipelines={meta.pipelines}
          target={{ recordId: dialog.record.id, version: dialog.record.version }}
          current={{ pipelineId: dialog.record.pipelineId, stageId: dialog.record.stageId, probability: dialog.record.probability, probabilitySource: dialog.record.probabilitySource }}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === "assign" && (
        <AssignOwnerModal apiBase={OPP_API} noun="opportunity" users={users} target={{ recordId: dialog.record.id, version: dialog.record.version }} currentOwnerId={dialog.record.ownerUserId} onClose={() => setDialog(null)} onDone={done} />
      )}
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive opportunity?"
        message={dialog?.kind === "archive" ? `${dialog.record.name} will be hidden from the board and active lists. Its timeline, notes, tags and ERP references are kept. You can restore it later.` : ""}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "archive" && archive(dialog.record)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

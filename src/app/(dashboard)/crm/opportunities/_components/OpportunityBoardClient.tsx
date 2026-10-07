"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmColumnPicker } from "@/components/crm/CrmColumnPicker";
import { formatCustomFieldValue } from "@/components/crm/CrmCustomFields";
import { CrmFilterBar, crmFilterKeys } from "@/components/crm/CrmFilterBar";
import { AssignOwnerModal } from "@/components/crm/CrmRecordDialogs";
import { crmRequest, type CrmApiError } from "@/components/crm/crm-api";
import { CardFieldList, conflictMessage, CrmKanbanBoard, type KanbanColumn, type KanbanNotice } from "@/components/crm/CrmKanbanBoard";
import { useCrmListState } from "@/components/crm/useCrmListState";
import type { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { isClosedStatus, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { CloseDate, OpportunityStatusBadge, opportunityValue } from "./OpportunityBadges";
import { ChangeStageModal } from "./OpportunityDialogs";
import type { OpportunityMetaDto, OpportunityPermissions, OpportunityRowDto, TransitionCheckDto, UserRefDto } from "./opportunity-types";
import { useOpportunityFilters } from "./useOpportunityFilters";

const OPP_API = "/api/v1/crm/opportunities";
const PER_STAGE = 20;
export const CONFLICT_MESSAGE = conflictMessage("Opportunity");

export type BoardCardDto = OpportunityRowDto & { customFields?: Record<string, unknown> | null };
export interface BoardColumnDto extends KanbanColumn<BoardCardDto> {
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

type Dialog = { kind: "stage"; record: BoardCardDto } | { kind: "assign"; record: BoardCardDto } | { kind: "archive"; record: BoardCardDto } | null;

const money = (values: BoardColumnDto["values"], pick: "total" | "weighted" | "average") =>
  values
    .filter((v) => v[pick] !== null)
    .map((v) => opportunityValue(v[pick], v.currencyCode))
    .join(" + ");

/** Turns a refused stage change into what the board shows (the server decides; nothing is re-validated here). */
export function moveFailureNotice(error: CrmApiError): KanbanNotice {
  if (error.code === "CRM_STAGE_TRANSITION_BLOCKED") {
    const d = error.details ?? {};
    return { kind: "blocked", reasons: (d.reasons as TransitionCheckDto["reasons"]) ?? [], missingFields: (d.missingFields as TransitionCheckDto["missingFields"]) ?? [] };
  }
  if (error.code === "RECORD_VERSION_CONFLICT" || error.status === 409) return { kind: "conflict" };
  return { kind: "error", message: error.message };
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

  const queryParams = new URLSearchParams({ perStage: String(PER_STAGE) });
  for (const [k, v] of Object.entries(listState.filters)) if (v) queryParams.set(k, v);
  if (listState.search) queryParams.set("search", listState.search);
  const query = pipelineId ? `/api/v1/crm/pipelines/${pipelineId}/board?${queryParams}` : null;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  /** A drop: the Phase 07 stage endpoint decides (rules, required fields, version). */
  const move = async (record: BoardCardDto, _from: BoardColumnDto, to: BoardColumnDto) => {
    const res = await crmRequest(`${OPP_API}/${record.id}/stage`, { method: "POST", body: { stageId: to.id, pipelineId, version: record.version }, toast: "off" });
    return res.ok ? { ok: true as const } : { ok: false as const, notice: moveFailureNotice(res.error) };
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

  const summary = (stages: BoardColumnDto[]) => {
    const totalCount = stages.reduce((n, s) => n + s.count, 0);
    const totals = new Map<string | null, { total: number; weighted: number }>();
    for (const st of stages)
      for (const v of st.values) {
        const t = totals.get(v.currencyCode) ?? { total: 0, weighted: 0 };
        totals.set(v.currencyCode, { total: t.total + v.total, weighted: t.weighted + v.weighted });
      }
    const totalValues = [...totals.entries()].map(([currencyCode, t]) => ({ currencyCode, total: Math.round(t.total * 100) / 100, weighted: Math.round(t.weighted * 100) / 100, average: null }));
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300" aria-live="polite">
        <span className="font-medium">{totalCount}</span> {totalCount === 1 ? "opportunity" : "opportunities"}
        {totalValues.length > 0 && (
          <>
            {" · "}value {money(totalValues, "total")} · weighted {money(totalValues, "weighted")}
          </>
        )}
        {!listState.filters.statuses && <span className="text-zinc-400"> · open deals</span>}
      </p>
    );
  };

  const header = (column: BoardColumnDto) => (
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
  );

  const card = (o: BoardCardDto, _column: BoardColumnDto, saving: boolean) => (
    <>
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
      <CardFieldList fields={cardFields} record={o} />
    </>
  );

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
        <Button size="sm" variant="secondary" onClick={reload}>
          Refresh
        </Button>
        {permissions.create && (
          <Link href="/crm/opportunities/new" className={buttonClasses("primary", "sm")}>
            New opportunity
          </Link>
        )}
      </div>

      <CrmFilterBar definitions={filters} value={listState.filters} onApply={listState.applyFilters} onClearAll={listState.clearFilters} isOpen={listState.isFilterPanelOpen} onToggleOpen={listState.toggleFilterPanel} />

      <CrmKanbanBoard<BoardCardDto, BoardColumnDto>
        query={query}
        columnsOf={(data) => (data as BoardDto).stages}
        pageQuery={(column, offset) => `${query}&stageId=${column.id}&offset=${offset}`}
        reloadKey={reloadKey}
        canDrag={permissions.edit}
        columnNoun="stage"
        recordNoun="Opportunity"
        recordNounPlural="opportunities"
        recordHref={(o) => `/crm/opportunities/${o.id}`}
        cardTitle={(o) => o.name}
        renderHeader={header}
        renderCard={card}
        onMove={move}
        optimistic={(o, to) => ({ ...o, stageId: to.id, stage: o.stage ? { ...o.stage, id: to.id, name: to.name } : o.stage })}
        renderSummary={summary}
        emptyMessage={`No opportunities match ${listState.search || Object.values(listState.filters).some(Boolean) ? "this search and these filters" : "in this pipeline yet"}.`}
      />

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

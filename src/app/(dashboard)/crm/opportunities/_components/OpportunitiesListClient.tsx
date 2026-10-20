"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { BulkActionsButton } from "@/components/bulk/BulkActionsButton";
import { CrmBulkBar } from "@/components/crm/CrmBulkBar";
import { CrmColumnPicker } from "@/components/crm/CrmColumnPicker";
import { crmFilterKeys } from "@/components/crm/CrmFilterBar";
import { AssignOwnerModal, bulkMessage, RecordTagsModal, type BulkResult } from "@/components/crm/CrmRecordDialogs";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmTable } from "@/components/crm/CrmTable";
import { useCrmListState } from "@/components/crm/useCrmListState";
import type { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { isClosedStatus, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { opportunityFilterToParams, parseOpportunityFilterParams } from "@/modules/crm/opportunities/opportunity.schema";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { CloseDate, OpportunityStatusBadge, opportunityValue } from "./OpportunityBadges";
import { BulkResultModal, BulkUpdateFieldsModal, ChangeOpportunityStatusModal, ChangeStageModal } from "./OpportunityDialogs";
import type { OpportunityMetaDto, OpportunityPermissions, OpportunityRowDto, TagDto, UserRefDto } from "./opportunity-types";
import { useOpportunityFilters } from "./useOpportunityFilters";

const API = "/api/v1/crm/opportunities";

export interface SavedViewDto {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: { sortBy: string; sortOrder: "asc" | "desc" } | null;
  columns: string[] | null;
  visibility: "PRIVATE" | "SHARED";
  isMine: boolean;
  owner: { fullName: string };
}

const ALL_COLUMNS: (DataTableColumn<OpportunityRowDto> & { defaultVisible: boolean })[] = [
  {
    key: "name",
    header: "Opportunity",
    sortable: true,
    defaultVisible: true,
    render: (o) => (
      <div className="min-w-[11rem]">
        <Link href={`/crm/opportunities/${o.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {o.name}
        </Link>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{[o.opportunityNumber, o.archivedAt ? "Archived" : null].filter(Boolean).join(" · ")}</div>
      </div>
    ),
  },
  { key: "company", header: "Company", defaultVisible: true, render: (o) => (o.crmCompany ? <Link href={`/crm/companies/${o.crmCompany.id}`} className="hover:underline">{o.crmCompany.name}</Link> : "—") },
  { key: "contact", header: "Contact", defaultVisible: true, render: (o) => (o.crmContact ? <Link href={`/crm/contacts/${o.crmContact.id}`} className="hover:underline">{o.crmContact.fullName}</Link> : "—") },
  { key: "pipeline", header: "Pipeline", defaultVisible: false, render: (o) => o.pipeline?.name ?? "—" },
  { key: "stage", header: "Stage", sortable: true, defaultVisible: true, render: (o) => o.stage?.name ?? "—" },
  { key: "amount", header: "Value", sortable: true, defaultVisible: true, render: (o) => <span className="whitespace-nowrap">{opportunityValue(o.amount, o.currencyCode) ?? "—"}</span> },
  { key: "probability", header: "Probability", sortable: true, defaultVisible: true, render: (o) => (o.probability !== null ? `${o.probability}%` : "—") },
  { key: "expectedCloseDate", header: "Expected close", sortable: true, defaultVisible: true, render: (o) => <CloseDate value={o.expectedCloseDate} status={o.status} /> },
  { key: "owner", header: "Owner", defaultVisible: true, render: (o) => <OwnerName owner={o.owner} inactive={o.ownerInactive} /> },
  { key: "status", header: "Status", defaultVisible: true, render: (o) => <OpportunityStatusBadge status={o.status} /> },
  { key: "source", header: "Source", defaultVisible: false, render: (o) => o.source?.name ?? "—" },
  {
    key: "tags",
    header: "Tags",
    defaultVisible: false,
    render: (o) =>
      o.tags.length ? (
        <div className="flex max-w-48 flex-wrap gap-1">
          {o.tags.map((t) => (
            <CrmBadge key={t.id} label={t.name} />
          ))}
        </div>
      ) : (
        "—"
      ),
  },
  { key: "lastActivityAt", header: "Last activity", sortable: true, defaultVisible: true, render: (o) => (o.lastActivityAt ? <ClientDateTime value={o.lastActivityAt} /> : "—") },
  { key: "createdAt", header: "Created", sortable: true, defaultVisible: false, render: (o) => <ClientDateTime value={o.createdAt} mode="date" /> },
];
const DEFAULT_COLUMNS = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

type Target = { recordId: string; version: number } | { ids: string[] };
type Dialog =
  | { kind: "assign"; target: Target; ownerId?: string | null }
  | { kind: "stage"; target: Target; row?: OpportunityRowDto }
  | { kind: "status"; target: Target; row?: OpportunityRowDto; status?: OpportunityStatus }
  | { kind: "tags"; target: { recordId: string } | { ids: string[] }; mode: "edit" | "add" | "remove"; tags?: TagDto[] }
  | { kind: "archive"; ids: string[]; label: string }
  | { kind: "restore"; row: OpportunityRowDto }
  | { kind: "saveView" }
  | { kind: "update"; ids: string[] }
  | { kind: "result"; title: string; result: BulkResult }
  | null;

/**
 * Opportunity List (Phase 06, extended in Phase 08): server-side search,
 * filters, sort and paging; saved views with a per-user default; columns
 * remembered per user; bulk actions that report every record they skipped.
 */
export function OpportunitiesListClient({
  permissions,
  meta,
  users,
  preferences,
}: {
  permissions: OpportunityPermissions;
  meta: OpportunityMetaDto | null;
  users: UserRefDto[];
  preferences: ReturnType<typeof useCrmPreferences>;
}) {
  const router = useRouter();
  const { prefs, setPreference } = preferences;
  const knownColumns = (keys: string[] | null | undefined) => (keys ?? []).filter((k) => ALL_COLUMNS.some((c) => c.key === k));
  const savedColumns = knownColumns(prefs["opportunities.list.columns"]);
  const defaultViewId = prefs["opportunities.list.defaultViewId"] ?? null;
  const [views, setViews] = useState<SavedViewDto[]>([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<string[]>(savedColumns.length ? savedColumns : DEFAULT_COLUMNS);
  const [sort, setSort] = useState<{ sortBy: string; sortOrder: "asc" | "desc" } | undefined>(undefined);
  const [tableKey, setTableKey] = useState("initial");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewShared, setViewShared] = useState(false);

  const { filters } = useOpportunityFilters({ meta, users, refreshKey });
  const listState = useCrmListState(crmFilterKeys(filters));
  // Phase 14: the list's current filters + search, for "all matching records" bulk jobs.
  const bulkFilterQuery = new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) }).toString();
  // The default view opens once, and only when the URL doesn't already ask for a search or filters.
  const defaultApplied = useRef(Boolean(listState.search) || Object.values(listState.filters).some(Boolean));

  const columns = ALL_COLUMNS.filter((c) => visibleColumns.includes(c.key));
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const done = (message?: string) => {
    setDialog(null);
    setRefreshKey((k) => k + 1);
    if (message) toast.success(message);
  };
  /** Bulk outcome: a toast when everything changed, otherwise a per-record list of what was skipped and why. */
  const doneBulk = (verb: string) => (r?: BulkResult) => {
    setSelected([]);
    setRefreshKey((k) => k + 1);
    if (!r) return setDialog(null);
    if (r.skipped.length) return setDialog({ kind: "result", title: bulkMessage(r, verb, "opportunity"), result: r });
    setDialog(null);
    toast.success(bulkMessage(r, verb, "opportunity"));
  };

  const columnsOrSaved = () => (savedColumns.length ? savedColumns : DEFAULT_COLUMNS);
  const applyView = (id: string, list: SavedViewDto[] = views) => {
    setActiveViewId(id);
    const view = list.find((v) => v.id === id);
    if (!view) {
      listState.replaceAll({}, "");
      setVisibleColumns(columnsOrSaved());
      setSort(undefined);
    } else {
      const { search, ...rest } = view.filters as { search?: string };
      listState.replaceAll(opportunityFilterToParams(rest), search ?? "");
      setVisibleColumns(knownColumns(view.columns).length ? knownColumns(view.columns) : columnsOrSaved());
      setSort(view.sort ?? undefined);
    }
    setTableKey(`view-${id}-${Date.now()}`);
  };
  const loadViews = () =>
    fetch("/api/v1/crm/saved-views?entityType=OPPORTUNITY")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => {
        const list: SavedViewDto[] = b.data ?? [];
        setViews(list);
        if (!defaultApplied.current) {
          defaultApplied.current = true;
          const view = list.find((v) => v.id === defaultViewId);
          if (view) applyView(view.id, list);
        }
        return list;
      })
      .catch(() => [] as SavedViewDto[]);
  useEffect(() => {
    void loadViews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const changeColumns = (keys: string[]) => {
    setVisibleColumns(keys);
    // Without a saved view open, the column choice is remembered for next time (a view keeps its own columns).
    if (!activeViewId) setPreference("opportunities.list.columns", keys);
  };

  const saveView = async (asNew: boolean) => {
    setBusy(true);
    let filterObject;
    try {
      filterObject = parseOpportunityFilterParams(new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) }));
    } catch {
      setBusy(false);
      toast.error("Fix the filters before saving the view.");
      return;
    }
    const body = { entityType: "OPPORTUNITY", name: asNew ? viewName : activeView?.name, filters: filterObject, sort: sort ?? null, columns: visibleColumns, visibility: asNew ? (viewShared ? "SHARED" : "PRIVATE") : activeView?.visibility };
    const res = asNew
      ? await crmRequest<SavedViewDto>("/api/v1/crm/saved-views", { method: "POST", body, successMessage: "View saved." })
      : await crmRequest<SavedViewDto>(`/api/v1/crm/saved-views/${activeViewId}`, { method: "PATCH", body, successMessage: "View updated." });
    setBusy(false);
    if (!res.ok) return;
    await loadViews();
    setActiveViewId(res.data.id);
    setDialog(null);
    setViewName("");
  };

  const deleteView = async () => {
    if (!activeView) return;
    const res = await crmRequest(`/api/v1/crm/saved-views/${activeView.id}`, { method: "DELETE", successMessage: "View deleted." });
    if (res.ok) {
      if (defaultViewId === activeView.id) setPreference("opportunities.list.defaultViewId", null);
      setActiveViewId("");
      await loadViews();
    }
  };

  const archive = async (ids: string[]) => {
    setBusy(true);
    if (ids.length === 1 && !selected.length) {
      const res = await crmRequest(`${API}/${ids[0]}/archive`, { method: "POST", successMessage: "Opportunity archived." });
      setBusy(false);
      if (res.ok) done();
      return;
    }
    const res = await crmRequest<BulkResult>(`${API}/bulk`, { method: "POST", body: { action: "archive", ids }, toast: "errors" });
    setBusy(false);
    if (res.ok) doneBulk("Archived")(res.data);
  };

  const restore = async (row: OpportunityRowDto) => {
    setBusy(true);
    const res = await crmRequest(`${API}/${row.id}/restore`, { method: "POST", successMessage: "Opportunity restored." });
    setBusy(false);
    if (res.ok) done();
  };

  const rowActions = (o: OpportunityRowDto) => {
    const closed = isClosedStatus(o.status as OpportunityStatus);
    const items = [{ label: "View", onClick: () => router.push(`/crm/opportunities/${o.id}`) }];
    if (permissions.edit && !o.archivedAt) {
      if (!closed) {
        items.push(
          { label: "Edit", onClick: () => router.push(`/crm/opportunities/${o.id}/edit`) },
          { label: "Change stage", onClick: () => setDialog({ kind: "stage", target: { recordId: o.id, version: o.version }, row: o }) },
          { label: "Mark won", onClick: () => setDialog({ kind: "status", target: { recordId: o.id, version: o.version }, row: o, status: "WON" }) },
          { label: "Mark lost / abandoned", onClick: () => setDialog({ kind: "status", target: { recordId: o.id, version: o.version }, row: o, status: "LOST" }) }
        );
      } else {
        items.push({ label: "Reopen", onClick: () => setDialog({ kind: "status", target: { recordId: o.id, version: o.version }, row: o, status: "OPEN" }) });
      }
      items.push(
        { label: "Assign", onClick: () => setDialog({ kind: "assign", target: { recordId: o.id, version: o.version }, ownerId: o.ownerUserId }) },
        { label: "Edit tags", onClick: () => setDialog({ kind: "tags", target: { recordId: o.id }, mode: "edit", tags: o.tags }) },
        { label: "Archive", onClick: () => setDialog({ kind: "archive", ids: [o.id], label: o.name }) }
      );
    }
    if (permissions.edit && o.archivedAt) items.push({ label: "Restore", onClick: () => setDialog({ kind: "restore", row: o }) });
    return <ActionMenu items={items} />;
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Saved view" value={activeViewId} onChange={(e) => applyView(e.target.value)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <option value="">All opportunities</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.visibility === "SHARED" ? (v.isMine ? " (shared)" : ` (by ${v.owner.fullName})`) : ""}
            {v.id === defaultViewId ? " ★" : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setDialog({ kind: "saveView" })} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        Save as view
      </button>
      {activeView?.isMine && (
        <>
          <button type="button" onClick={() => saveView(false)} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" disabled={busy}>
            Update view
          </button>
          <button type="button" onClick={deleteView} className="text-sm text-red-600 hover:underline dark:text-red-400">
            Delete view
          </button>
        </>
      )}
      {activeViewId !== (defaultViewId ?? "") && (activeView || defaultViewId) && (
        <button type="button" onClick={() => setPreference("opportunities.list.defaultViewId", activeViewId || null)} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Set as my default
        </button>
      )}
      {activeView && activeViewId === defaultViewId && <span className="text-xs text-zinc-500 dark:text-zinc-400">Your default view</span>}
      <BulkActionsButton entityType="OPPORTUNITY" selectedIds={selected} filterQuery={bulkFilterQuery} onSubmitted={() => setSelected([])} />
      <CrmColumnPicker columns={ALL_COLUMNS.map((c) => ({ key: c.key, header: c.header }))} visibleKeys={visibleColumns} onChange={changeColumns} />
      {permissions.create && (
        <Link href="/crm/opportunities/new" className={buttonClasses("primary", "sm")}>
          New opportunity
        </Link>
      )}
    </div>
  );

  const target = dialog && "target" in dialog ? dialog.target : null;
  return (
    <>
      <CrmTable<OpportunityRowDto>
        fetchUrl={API}
        columns={columns}
        filters={filters}
        listState={listState}
        searchPlaceholder="Search name, number, company, contact, owner, email, phone, ERP document number…"
        rowHref={(o) => `/crm/opportunities/${o.id}`}
        rowActions={rowActions}
        refreshKey={refreshKey}
        toolbar={toolbar}
        tableKey={tableKey}
        initialSort={sort}
        onSortChange={setSort}
        selection={permissions.edit ? { selectedIds: selected, onChange: setSelected, label: (o) => o.name } : undefined}
        aboveTable={
          <CrmBulkBar count={selected.length} onClear={() => setSelected([])}>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "assign", target: { ids: selected } })}>
              Assign
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "stage", target: { ids: selected } })}>
              Change stage
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "status", target: { ids: selected } })}>
              Change status
            </Button>
            {meta && (
              <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "update", ids: selected })}>
                Update fields
              </Button>
            )}
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "tags", target: { ids: selected }, mode: "add" })}>
              Add tags
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "tags", target: { ids: selected }, mode: "remove" })}>
              Remove tags
            </Button>
            <Button size="xs" variant="danger" onClick={() => setDialog({ kind: "archive", ids: selected, label: `${selected.length} opportunity(ies)` })}>
              Archive
            </Button>
            <BulkActionsButton entityType="OPPORTUNITY" size="xs" label="More bulk actions…" selectedIds={selected} filterQuery={bulkFilterQuery} onSubmitted={() => setSelected([])} />
          </CrmBulkBar>
        }
      />

      {dialog?.kind === "assign" && target && (
        <AssignOwnerModal apiBase={API} noun="opportunity" onClose={() => setDialog(null)} users={users} target={target} currentOwnerId={dialog.ownerId} onDone={"ids" in target ? doneBulk("Assigned") : () => done()} />
      )}
      {dialog?.kind === "stage" && meta && target && (
        <ChangeStageModal
          pipelines={meta.pipelines}
          target={target}
          current={dialog.row ? { pipelineId: dialog.row.pipelineId, stageId: dialog.row.stageId, probability: dialog.row.probability } : undefined}
          onClose={() => setDialog(null)}
          onDone={"ids" in target ? doneBulk("Moved") : () => done()}
        />
      )}
      {dialog?.kind === "status" && target && (
        <ChangeOpportunityStatusModal
          target={target}
          current={dialog.row?.status as OpportunityStatus | undefined}
          initialStatus={dialog.status}
          reasons={meta?.suggestions.opportunity_close_reason ?? []}
          onClose={() => setDialog(null)}
          onDone={"ids" in target ? doneBulk("Updated") : () => done()}
        />
      )}
      {dialog?.kind === "tags" && (
        <RecordTagsModal apiBase={API} noun="opportunity" onClose={() => setDialog(null)} target={dialog.target} mode={dialog.mode} currentTags={dialog.tags} onDone={"ids" in dialog.target ? doneBulk("Updated") : () => done()} />
      )}
      {dialog?.kind === "update" && meta && <BulkUpdateFieldsModal ids={dialog.ids} meta={meta} onClose={() => setDialog(null)} onDone={doneBulk("Updated")} />}
      {dialog?.kind === "result" && <BulkResultModal title={dialog.title} result={dialog.result} onClose={() => setDialog(null)} />}
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive opportunity?"
        message={dialog?.kind === "archive" ? `${dialog.label} will be hidden from active lists. Its timeline, notes, documents, tags and ERP references are kept; nothing changes in the ERP. You can restore it later.` : ""}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "archive" && archive(dialog.ids)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore opportunity?"
        message={dialog?.kind === "restore" ? `${dialog.row.name} will be active again.` : ""}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => dialog?.kind === "restore" && restore(dialog.row)}
        onCancel={() => setDialog(null)}
      />
      <Modal open={dialog?.kind === "saveView"} onClose={() => setDialog(null)} title="Save current view">
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (viewName.trim()) void saveView(true);
          }}
        >
          <FormField label="View name" htmlFor="view-name" required>
            <input id="view-name" className={textInputClass()} value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={80} autoFocus />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            <input type="checkbox" checked={viewShared} onChange={(e) => setViewShared(e.target.checked)} />
            Share with everyone who uses the CRM
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Saves the current search, filters, sort and columns. Each person still only sees the opportunities they have access to.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" isLoading={busy} disabled={!viewName.trim()}>
              Save view
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

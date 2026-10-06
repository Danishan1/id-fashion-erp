"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmBulkBar } from "@/components/crm/CrmBulkBar";
import { CrmColumnPicker } from "@/components/crm/CrmColumnPicker";
import { crmFilterKeys, type CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { AssignOwnerModal, bulkMessage, RecordTagsModal, type BulkResult } from "@/components/crm/CrmRecordDialogs";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmTable } from "@/components/crm/CrmTable";
import { useCrmListState } from "@/components/crm/useCrmListState";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { isClosedStatus, OPPORTUNITY_STATUSES, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { opportunityFilterToParams, parseOpportunityFilterParams } from "@/modules/crm/opportunities/opportunity.schema";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { CloseDate, OpportunityStatusBadge, opportunityValue } from "./OpportunityBadges";
import { ChangeOpportunityStatusModal, ChangeStageModal } from "./OpportunityDialogs";
import type { OpportunityPermissions, OpportunityRowDto, TagDto } from "./opportunity-types";
import { useOpportunityLookups } from "./useOpportunityLookups";

const API = "/api/v1/crm/opportunities";

interface SavedViewDto {
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
  | null;

export function OpportunitiesListClient({ permissions }: { permissions: OpportunityPermissions }) {
  const router = useRouter();
  const { meta, users } = useOpportunityLookups();
  const [tags, setTags] = useState<TagDto[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [contacts, setContacts] = useState<{ id: string; fullName: string }[]>([]);
  const [views, setViews] = useState<SavedViewDto[]>([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<{ sortBy: string; sortOrder: "asc" | "desc" } | undefined>(undefined);
  const [tableKey, setTableKey] = useState("initial");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewShared, setViewShared] = useState(false);

  const filters: CrmFilterDefinition[] = useMemo(() => {
    const multiPipeline = (meta?.pipelines.length ?? 0) > 1;
    return [
      ...(multiPipeline ? [{ type: "select" as const, key: "pipelineIds", label: "Pipeline", options: (meta?.pipelines ?? []).map((p) => ({ value: p.id, label: p.name })) }] : []),
      {
        type: "select",
        key: "stageIds",
        label: "Stage",
        options: (meta?.pipelines ?? []).flatMap((p) => p.stages.map((s) => ({ value: s.id, label: multiPipeline ? `${p.name} · ${s.name}` : s.name }))),
      },
      { type: "select", key: "statuses", label: "Status", options: Object.entries(OPPORTUNITY_STATUSES).map(([k, s]) => ({ value: k, label: s.label })) },
      { type: "select", key: "ownerUserIds", label: "Owner", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
      { type: "select", key: "unassigned", label: "Assignment", options: [{ value: "true", label: "Unassigned only" }] },
      { type: "select", key: "crmCompanyIds", label: "Company", options: companies.map((c) => ({ value: c.id, label: c.name })) },
      { type: "select", key: "crmContactIds", label: "Contact", options: contacts.map((c) => ({ value: c.id, label: c.fullName })) },
      { type: "select", key: "sourceIds", label: "Source", options: (meta?.sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "tagIds", label: "Tag", options: tags.map((t) => ({ value: t.id, label: t.name })) },
      {
        type: "select",
        key: "closeDue",
        label: "Closing",
        options: [
          { value: "overdue", label: "Overdue (open, date passed)" },
          { value: "next_7_days", label: "Next 7 days" },
          { value: "next_30_days", label: "Next 30 days" },
          { value: "this_month", label: "This month" },
        ],
      },
      { type: "dateRange", label: "Expected close", fromKey: "expectedCloseDateFrom", toKey: "expectedCloseDateTo" },
      { type: "numberRange", label: "Value", minKey: "amountMin", maxKey: "amountMax" },
      { type: "numberRange", label: "Probability %", minKey: "probabilityMin", maxKey: "probabilityMax", step: 5 },
      { type: "select", key: "fromLead", label: "Origin", options: [{ value: "yes", label: "From a lead" }, { value: "no", label: "Created directly" }] },
      { type: "dateRange", label: "Created", fromKey: "createdAtFrom", toKey: "createdAtTo" },
      { type: "dateRange", label: "Updated", fromKey: "updatedAtFrom", toKey: "updatedAtTo" },
      { type: "select", key: "archived", label: "Archived", anyLabel: "Active opportunities only", options: [{ value: "only", label: "Archived only" }, { value: "include", label: "Active and archived" }] },
    ];
  }, [meta, users, tags, companies, contacts]);
  const listState = useCrmListState(crmFilterKeys(filters));

  const loadViews = () =>
    fetch("/api/v1/crm/saved-views?entityType=OPPORTUNITY")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setViews(b.data ?? []))
      .catch(() => {});
  useEffect(() => {
    void loadViews();
    const load = <T,>(url: string, set: (v: T[]) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => set(b.data ?? []))
        .catch(() => {});
    load<TagDto>("/api/v1/crm/tags", setTags);
    load<{ id: string; name: string }>("/api/v1/crm/companies/lookup?limit=200", setCompanies);
    load<{ id: string; fullName: string }>("/api/v1/crm/contacts/lookup?limit=200", setContacts);
  }, [refreshKey]);

  const columns = ALL_COLUMNS.filter((c) => visibleColumns.includes(c.key));
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const done = (message?: string) => {
    setDialog(null);
    setRefreshKey((k) => k + 1);
    if (message) toast.success(message);
  };
  const doneBulk = (verb: string) => (r?: BulkResult) => {
    setSelected([]);
    done(r ? bulkMessage(r, verb, "opportunity") : undefined);
    if (r?.skipped.length) toast.warning(`Skipped: ${[...new Set(r.skipped.map((s) => s.reason))].join("; ")}`);
  };

  const applyView = (id: string) => {
    setActiveViewId(id);
    const view = views.find((v) => v.id === id);
    if (!view) {
      listState.replaceAll({}, "");
      setVisibleColumns(DEFAULT_COLUMNS);
      setSort(undefined);
    } else {
      const { search, ...rest } = view.filters as { search?: string };
      listState.replaceAll(opportunityFilterToParams(rest), search ?? "");
      setVisibleColumns(view.columns?.length ? view.columns.filter((k) => ALL_COLUMNS.some((c) => c.key === k)) : DEFAULT_COLUMNS);
      setSort(view.sort ?? undefined);
    }
    setTableKey(`view-${id}-${Date.now()}`);
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
      <CrmColumnPicker columns={ALL_COLUMNS.map((c) => ({ key: c.key, header: c.header }))} visibleKeys={visibleColumns} onChange={setVisibleColumns} />
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
        searchPlaceholder="Search name, number, company, contact, email, phone, ERP document number…"
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
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "tags", target: { ids: selected }, mode: "add" })}>
              Add tags
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "tags", target: { ids: selected }, mode: "remove" })}>
              Remove tags
            </Button>
            <Button size="xs" variant="danger" onClick={() => setDialog({ kind: "archive", ids: selected, label: `${selected.length} opportunity(ies)` })}>
              Archive
            </Button>
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

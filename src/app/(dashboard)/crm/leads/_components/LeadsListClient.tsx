"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmBulkBar } from "@/components/crm/CrmBulkBar";
import { CrmColumnPicker } from "@/components/crm/CrmColumnPicker";
import { crmFilterKeys, type CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
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
import { formatCurrency } from "@/lib/currency";
import { leadFilterToParams, parseLeadFilterParams } from "@/modules/crm/leads/lead.schema";
import { LeadStatusBadge, LeadTemperatureBadge, OwnerName } from "./LeadBadges";
import { AssignLeadModal, bulkMessage, ChangeStatusModal, CreateOpportunityModal, LeadTagsModal, type BulkResult } from "./LeadDialogs";
import type { LeadPermissions, LeadRowDto, TagDto } from "./lead-types";
import { useLeadLookups } from "./useLeadLookups";

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

const ALL_COLUMNS: (DataTableColumn<LeadRowDto> & { defaultVisible: boolean })[] = [
  {
    key: "fullName",
    header: "Lead",
    sortable: true,
    defaultVisible: true,
    render: (l) => (
      <div className="min-w-[9rem]">
        <Link href={`/crm/leads/${l.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {l.fullName}
        </Link>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {l.leadNumber}
          {l.archivedAt && " · Archived"}
        </div>
      </div>
    ),
  },
  { key: "companyName", header: "Company", defaultVisible: true, render: (l) => l.crmCompany?.name ?? l.companyName ?? "—" },
  { key: "phone", header: "Phone", defaultVisible: true, render: (l) => <span className="whitespace-nowrap">{l.phone ?? l.mobile ?? l.whatsapp ?? "—"}</span> },
  { key: "email", header: "Email", defaultVisible: true, render: (l) => l.email ?? "—" },
  { key: "source", header: "Source", defaultVisible: true, render: (l) => l.source?.name ?? "—" },
  { key: "status", header: "Status", defaultVisible: true, render: (l) => <LeadStatusBadge status={l.status} /> },
  { key: "owner", header: "Owner", defaultVisible: true, render: (l) => <OwnerName owner={l.owner} inactive={l.ownerInactive} /> },
  { key: "score", header: "Score", sortable: true, defaultVisible: false, render: (l) => String(l.score) },
  { key: "temperature", header: "Temp.", defaultVisible: true, render: (l) => <LeadTemperatureBadge temperature={l.temperature} /> },
  {
    key: "tags",
    header: "Tags",
    defaultVisible: true,
    render: (l) =>
      l.tags.length ? (
        <div className="flex max-w-48 flex-wrap gap-1">
          {l.tags.map((t) => (
            <CrmBadge key={t.id} label={t.name} />
          ))}
        </div>
      ) : (
        "—"
      ),
  },
  {
    key: "estimatedValue",
    header: "Est. value",
    sortable: true,
    defaultVisible: false,
    render: (l) => (l.estimatedValue ? `${l.currencyCode ?? ""} ${formatCurrency(l.estimatedValue)}`.trim() : "—"),
  },
  { key: "lastContactedAt", header: "Last contacted", sortable: true, defaultVisible: false, render: (l) => (l.lastContactedAt ? <ClientDateTime value={l.lastContactedAt} /> : "—") },
  {
    key: "nextFollowUpAt",
    header: "Next follow-up",
    sortable: true,
    defaultVisible: true,
    render: (l) =>
      l.nextFollowUpAt ? (
        <span className={new Date(l.nextFollowUpAt) < new Date() && !l.convertedAt ? "text-red-600 dark:text-red-400" : undefined}>
          <ClientDateTime value={l.nextFollowUpAt} />
        </span>
      ) : (
        "—"
      ),
  },
  { key: "createdAt", header: "Created", sortable: true, defaultVisible: true, render: (l) => <ClientDateTime value={l.createdAt} mode="date" /> },
];
const DEFAULT_COLUMNS = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

type Dialog =
  | { kind: "assign"; target: { leadId: string; version: number } | { ids: string[] }; ownerId?: string | null }
  | { kind: "status"; target: { leadId: string; version: number } | { ids: string[] }; statusId?: string }
  | { kind: "tags"; target: { leadId: string } | { ids: string[] }; mode: "edit" | "add" | "remove"; tags?: TagDto[] }
  | { kind: "archive"; ids: string[]; label: string }
  | { kind: "restore"; lead: LeadRowDto }
  | { kind: "opportunity"; lead: LeadRowDto }
  | { kind: "saveView" }
  | null;

export function LeadsListClient({ permissions }: { permissions: LeadPermissions }) {
  const router = useRouter();
  const { meta, users } = useLeadLookups();
  const [tags, setTags] = useState<TagDto[]>([]);
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

  const filters: CrmFilterDefinition[] = useMemo(
    () => [
      { type: "select", key: "statusIds", label: "Status", options: (meta?.statuses ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "sourceIds", label: "Source", options: (meta?.sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      {
        type: "select",
        key: "captureChannels",
        label: "Captured via",
        options: [
          { value: "MANUAL", label: "Manual entry" },
          { value: "CSV", label: "CSV import" },
          { value: "XLSX", label: "Excel import" },
          { value: "WEBSITE_FORM", label: "Website form" },
          { value: "API", label: "API" },
          { value: "WEBHOOK", label: "Webhook" },
        ],
      },
      { type: "text", key: "importJobId", label: "Import ID", placeholder: "From Import history" },
      { type: "select", key: "ownerUserIds", label: "Owner", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
      { type: "select", key: "unassigned", label: "Assignment", options: [{ value: "true", label: "Unassigned only" }] },
      {
        type: "select",
        key: "temperatures",
        label: "Temperature",
        options: [
          { value: "HOT", label: "Hot" },
          { value: "WARM", label: "Warm" },
          { value: "COLD", label: "Cold" },
        ],
      },
      { type: "select", key: "tagIds", label: "Tag", options: tags.map((t) => ({ value: t.id, label: t.name })) },
      { type: "text", key: "companyName", label: "Company", placeholder: "Company name contains…" },
      { type: "text", key: "industry", label: "Industry" },
      { type: "text", key: "location", label: "Location", placeholder: "City, state or country" },
      { type: "text", key: "campaignSource", label: "Campaign source" },
      { type: "text", key: "referralSource", label: "Referred by" },
      { type: "numberRange", label: "Score", minKey: "scoreMin", maxKey: "scoreMax", step: 1 },
      { type: "numberRange", label: "Estimated value", minKey: "estimatedValueMin", maxKey: "estimatedValueMax" },
      { type: "dateRange", label: "Created", fromKey: "createdAtFrom", toKey: "createdAtTo" },
      { type: "dateRange", label: "Updated", fromKey: "updatedAtFrom", toKey: "updatedAtTo" },
      { type: "dateRange", label: "Last contacted", fromKey: "lastContactedAtFrom", toKey: "lastContactedAtTo" },
      { type: "dateRange", label: "Next follow-up", fromKey: "nextFollowUpAtFrom", toKey: "nextFollowUpAtTo" },
      {
        type: "select",
        key: "archived",
        label: "Archived",
        anyLabel: "Active leads only",
        options: [
          { value: "only", label: "Archived only" },
          { value: "include", label: "Active and archived" },
        ],
      },
    ],
    [meta, users, tags]
  );
  const listState = useCrmListState(crmFilterKeys(filters));

  const loadViews = () =>
    fetch("/api/v1/crm/saved-views?entityType=LEAD")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setViews(b.data ?? []))
      .catch(() => {});
  useEffect(() => {
    void loadViews();
    fetch("/api/v1/crm/tags")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setTags(b.data ?? []))
      .catch(() => {});
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
    done(r ? bulkMessage(r, verb) : undefined);
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
      listState.replaceAll(leadFilterToParams(rest), search ?? "");
      setVisibleColumns(view.columns?.length ? view.columns.filter((k) => ALL_COLUMNS.some((c) => c.key === k)) : DEFAULT_COLUMNS);
      setSort(view.sort ?? undefined);
    }
    setTableKey(`view-${id}-${Date.now()}`);
  };

  const currentFilterObject = () => {
    const sp = new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) });
    return parseLeadFilterParams(sp);
  };

  const saveView = async (asNew: boolean) => {
    setBusy(true);
    const body = { entityType: "LEAD", name: asNew ? viewName : activeView?.name, filters: currentFilterObject(), sort: sort ?? null, columns: visibleColumns, visibility: asNew ? (viewShared ? "SHARED" : "PRIVATE") : activeView?.visibility };
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
      const res = await crmRequest(`/api/v1/crm/leads/${ids[0]}/archive`, { method: "POST", successMessage: "Lead archived." });
      setBusy(false);
      if (res.ok) done();
      return;
    }
    const res = await crmRequest<BulkResult>("/api/v1/crm/leads/bulk", { method: "POST", body: { action: "archive", ids }, toast: "errors" });
    setBusy(false);
    if (res.ok) doneBulk("Archived")(res.data);
  };

  const restore = async (lead: LeadRowDto) => {
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/leads/${lead.id}/restore`, { method: "POST", successMessage: "Lead restored." });
    setBusy(false);
    if (res.ok) done();
  };

  const rowActions = (l: LeadRowDto) => {
    const items = [{ label: "View", onClick: () => router.push(`/crm/leads/${l.id}`) }];
    if (permissions.edit && !l.archivedAt) {
      items.push(
        { label: "Edit", onClick: () => router.push(`/crm/leads/${l.id}/edit`) },
        { label: "Assign", onClick: () => setDialog({ kind: "assign", target: { leadId: l.id, version: l.version }, ownerId: l.ownerUserId }) },
        ...(l.convertedAt ? [] : [{ label: "Change status", onClick: () => setDialog({ kind: "status", target: { leadId: l.id, version: l.version }, statusId: l.status.id }) }]),
        { label: "Edit tags", onClick: () => setDialog({ kind: "tags", target: { leadId: l.id }, mode: "edit", tags: l.tags }) },
        { label: "Add note", onClick: () => router.push(`/crm/leads/${l.id}#notes`) },
        { label: "Create opportunity", onClick: () => setDialog({ kind: "opportunity", lead: l }) },
        ...(l.convertedAt ? [] : [{ label: "Convert", onClick: () => router.push(`/crm/leads/${l.id}?convert=1`) }]),
        { label: "Archive", onClick: () => setDialog({ kind: "archive", ids: [l.id], label: l.fullName }) }
      );
    }
    if (permissions.edit && l.archivedAt) items.push({ label: "Restore", onClick: () => setDialog({ kind: "restore", lead: l }) });
    return <ActionMenu items={items} />;
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Saved view" value={activeViewId} onChange={(e) => applyView(e.target.value)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <option value="">All leads</option>
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
        <>
          <Link href="/crm/leads/import" className={buttonClasses("secondary", "sm")}>
            Import
          </Link>
          <Link href="/crm/leads/new" className={buttonClasses("primary", "sm")}>
            New lead
          </Link>
        </>
      )}

    </div>
  );

  return (
    <>
      <CrmTable<LeadRowDto>
        fetchUrl="/api/v1/crm/leads"
        columns={columns}
        filters={filters}
        listState={listState}
        searchPlaceholder="Search name, phone, email, company, lead #…"
        rowHref={(l) => `/crm/leads/${l.id}`}
        rowActions={rowActions}
        refreshKey={refreshKey}
        toolbar={toolbar}
        tableKey={tableKey}
        initialSort={sort}
        onSortChange={setSort}
        selection={permissions.edit ? { selectedIds: selected, onChange: setSelected, label: (l) => l.fullName } : undefined}
        aboveTable={
          <CrmBulkBar count={selected.length} onClear={() => setSelected([])}>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "assign", target: { ids: selected } })}>
              Assign
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
            <Button size="xs" variant="danger" onClick={() => setDialog({ kind: "archive", ids: selected, label: `${selected.length} lead(s)` })}>
              Archive
            </Button>
          </CrmBulkBar>
        }
      />

      {dialog?.kind === "assign" && (
        <AssignLeadModal open onClose={() => setDialog(null)} users={users} target={dialog.target} currentOwnerId={dialog.ownerId} onDone={"ids" in dialog.target ? doneBulk("Assigned") : () => done()} />
      )}
      {dialog?.kind === "status" && meta && (
        <ChangeStatusModal open onClose={() => setDialog(null)} statuses={meta.statuses} target={dialog.target} currentStatusId={dialog.statusId} onDone={"ids" in dialog.target ? doneBulk("Updated") : () => done()} />
      )}
      {dialog?.kind === "tags" && (
        <LeadTagsModal open onClose={() => setDialog(null)} target={dialog.target} mode={dialog.mode} currentTags={dialog.tags} onDone={"ids" in dialog.target ? doneBulk("Updated") : () => done()} />
      )}
      {dialog?.kind === "opportunity" && (
        <CreateOpportunityModal
          open
          onClose={() => setDialog(null)}
          lead={dialog.lead}
          onDone={(opp) => {
            done();
            toast.info(`${opp.opportunityNumber} created. Opportunity pages arrive in a later phase; it is listed on the lead.`);
          }}
        />
      )}
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive lead?"
        message={dialog?.kind === "archive" ? `${dialog.label} will be hidden from active lists. History, notes and tags are kept, and you can restore it later.` : ""}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "archive" && archive(dialog.ids)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore lead?"
        message={dialog?.kind === "restore" ? `${dialog.lead.fullName} will be active again.` : ""}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => dialog?.kind === "restore" && restore(dialog.lead)}
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Saves the current search, filters, sort and columns. Each person still only sees the leads they have access to.</p>
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

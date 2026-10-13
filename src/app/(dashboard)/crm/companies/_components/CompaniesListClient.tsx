"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { BulkActionsButton } from "@/components/bulk/BulkActionsButton";
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
import { companyFilterToParams, parseCompanyFilterParams } from "@/modules/crm/companies/company.schema";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { ChangeCompanyStatusModal } from "./CompanyDialogs";
import type { CompanyPermissions, CompanyRowDto, TagDto } from "./company-types";
import { useCompanyLookups } from "./useCompanyLookups";

const API = "/api/v1/crm/companies";
const TONES = new Set(["neutral", "indigo", "green", "amber", "red"]);

export function CompanyStatusBadge({ status }: { status: { name: string; color: string | null } | null }) {
  if (!status) return <span className="text-zinc-400">—</span>;
  return <CrmBadge label={status.name} tone={(status.color && TONES.has(status.color) ? status.color : "neutral") as CrmBadgeTone} />;
}

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

const ALL_COLUMNS: (DataTableColumn<CompanyRowDto> & { defaultVisible: boolean })[] = [
  {
    key: "name",
    header: "Company",
    sortable: true,
    defaultVisible: true,
    render: (c) => (
      <div className="min-w-[10rem]">
        <Link href={`/crm/companies/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {c.name}
        </Link>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {[c.legalName && c.legalName !== c.name ? c.legalName : null, c.archivedAt ? "Archived" : null].filter(Boolean).join(" · ")}
          {c.duplicateFlaggedAt && <span className="ml-1 text-amber-600 dark:text-amber-400">· Possible duplicate</span>}
        </div>
      </div>
    ),
  },
  { key: "industry", header: "Industry", sortable: true, defaultVisible: true, render: (c) => c.industry ?? "—" },
  { key: "primaryContact", header: "Primary contact", defaultVisible: true, render: (c) => (c.primaryContact ? <Link href={`/crm/contacts/${c.primaryContact.id}`} className="hover:underline">{c.primaryContact.fullName}</Link> : "—") },
  { key: "owner", header: "Owner", defaultVisible: true, render: (c) => <OwnerName owner={c.owner} inactive={c.ownerInactive} /> },
  { key: "status", header: "Status", defaultVisible: true, render: (c) => <CompanyStatusBadge status={c.status} /> },
  { key: "source", header: "Source", defaultVisible: false, render: (c) => c.source?.name ?? "—" },
  { key: "phone", header: "Phone", defaultVisible: true, render: (c) => <span className="whitespace-nowrap">{c.phone ?? c.mobile ?? "—"}</span> },
  { key: "email", header: "Email", defaultVisible: false, render: (c) => c.email ?? "—" },
  { key: "city", header: "City", sortable: true, defaultVisible: true, render: (c) => [c.city, c.country].filter(Boolean).join(", ") || "—" },
  { key: "erpCustomer", header: "ERP customer", defaultVisible: true, render: (c) => (c.customer ? <span title={c.customer.name}>{c.customer.code}</span> : <span className="text-zinc-400">—</span>) },
  { key: "openOpportunities", header: "Open opps", defaultVisible: true, render: (c) => (c.openOpportunities ? String(c.openOpportunities) : "—") },
  {
    key: "tags",
    header: "Tags",
    defaultVisible: false,
    render: (c) =>
      c.tags.length ? (
        <div className="flex max-w-48 flex-wrap gap-1">
          {c.tags.map((t) => (
            <CrmBadge key={t.id} label={t.name} />
          ))}
        </div>
      ) : (
        "—"
      ),
  },
  { key: "lastActivityAt", header: "Last activity", sortable: true, defaultVisible: true, render: (c) => (c.lastActivityAt ? <ClientDateTime value={c.lastActivityAt} /> : "—") },
  { key: "createdAt", header: "Created", sortable: true, defaultVisible: true, render: (c) => <ClientDateTime value={c.createdAt} mode="date" /> },
];
const DEFAULT_COLUMNS = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

type Dialog =
  | { kind: "assign"; target: { recordId: string; version: number } | { ids: string[] }; ownerId?: string | null }
  | { kind: "status"; target: { recordId: string; version: number } | { ids: string[] }; statusId?: string | null }
  | { kind: "tags"; target: { recordId: string } | { ids: string[] }; mode: "edit" | "add" | "remove"; tags?: TagDto[] }
  | { kind: "archive"; ids: string[]; label: string }
  | { kind: "restore"; company: CompanyRowDto }
  | { kind: "saveView" }
  | null;

export function CompaniesListClient({ permissions }: { permissions: CompanyPermissions }) {
  const router = useRouter();
  const { meta, users } = useCompanyLookups();
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
      { type: "select", key: "ownerUserIds", label: "Owner", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
      { type: "select", key: "unassigned", label: "Assignment", options: [{ value: "true", label: "Unassigned only" }] },
      { type: "select", key: "statusIds", label: "Status", options: (meta?.statuses ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "sourceIds", label: "Source", options: (meta?.sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "tagIds", label: "Tag", options: tags.map((t) => ({ value: t.id, label: t.name })) },
      { type: "text", key: "industry", label: "Industry" },
      { type: "text", key: "companyType", label: "Company type" },
      { type: "text", key: "city", label: "City" },
      { type: "text", key: "state", label: "State" },
      { type: "text", key: "country", label: "Country" },
      { type: "select", key: "erpCustomer", label: "ERP customer", options: [{ value: "linked", label: "Linked to an ERP customer" }, { value: "not_linked", label: "Not linked" }] },
      { type: "select", key: "fromLead", label: "Origin", options: [{ value: "yes", label: "Converted from a lead" }, { value: "no", label: "Created directly" }] },
      { type: "select", key: "duplicateFlagged", label: "Duplicates", options: [{ value: "true", label: "Flagged as possible duplicate" }] },
      { type: "dateRange", label: "Last activity", fromKey: "lastActivityAtFrom", toKey: "lastActivityAtTo" },
      { type: "dateRange", label: "Created", fromKey: "createdAtFrom", toKey: "createdAtTo" },
      { type: "dateRange", label: "Updated", fromKey: "updatedAtFrom", toKey: "updatedAtTo" },
      { type: "select", key: "archived", label: "Archived", anyLabel: "Active companies only", options: [{ value: "only", label: "Archived only" }, { value: "include", label: "Active and archived" }] },
    ],
    [meta, users, tags]
  );
  const listState = useCrmListState(crmFilterKeys(filters));
  // Phase 14: the list's current filters + search, for "all matching records" bulk jobs.
  const bulkFilterQuery = new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) }).toString();

  const loadViews = () =>
    fetch("/api/v1/crm/saved-views?entityType=COMPANY")
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
    done(r ? bulkMessage(r, verb, "company") : undefined);
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
      listState.replaceAll(companyFilterToParams(rest), search ?? "");
      setVisibleColumns(view.columns?.length ? view.columns.filter((k) => ALL_COLUMNS.some((c) => c.key === k)) : DEFAULT_COLUMNS);
      setSort(view.sort ?? undefined);
    }
    setTableKey(`view-${id}-${Date.now()}`);
  };

  const saveView = async (asNew: boolean) => {
    setBusy(true);
    const filterObject = parseCompanyFilterParams(new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) }));
    const body = { entityType: "COMPANY", name: asNew ? viewName : activeView?.name, filters: filterObject, sort: sort ?? null, columns: visibleColumns, visibility: asNew ? (viewShared ? "SHARED" : "PRIVATE") : activeView?.visibility };
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
      const res = await crmRequest(`${API}/${ids[0]}/archive`, { method: "POST", successMessage: "Company archived." });
      setBusy(false);
      if (res.ok) done();
      return;
    }
    const res = await crmRequest<BulkResult>(`${API}/bulk`, { method: "POST", body: { action: "archive", ids }, toast: "errors" });
    setBusy(false);
    if (res.ok) doneBulk("Archived")(res.data);
  };

  const restore = async (company: CompanyRowDto) => {
    setBusy(true);
    const res = await crmRequest(`${API}/${company.id}/restore`, { method: "POST", successMessage: "Company restored." });
    setBusy(false);
    if (res.ok) done();
  };

  const rowActions = (c: CompanyRowDto) => {
    const items = [{ label: "View", onClick: () => router.push(`/crm/companies/${c.id}`) }];
    if (permissions.edit && !c.archivedAt) {
      items.push(
        { label: "Edit", onClick: () => router.push(`/crm/companies/${c.id}/edit`) },
        { label: "Assign", onClick: () => setDialog({ kind: "assign", target: { recordId: c.id, version: c.version }, ownerId: c.ownerUserId }) },
        { label: "Change status", onClick: () => setDialog({ kind: "status", target: { recordId: c.id, version: c.version }, statusId: c.status?.id }) },
        { label: "Edit tags", onClick: () => setDialog({ kind: "tags", target: { recordId: c.id }, mode: "edit", tags: c.tags }) },
        { label: "Merge with…", onClick: () => router.push(`/crm/companies/merge?ids=${c.id}`) },
        { label: "Archive", onClick: () => setDialog({ kind: "archive", ids: [c.id], label: c.name }) }
      );
    }
    if (c.customer) items.push({ label: "Open ERP customer", onClick: () => router.push(`/masters/customers/${c.customer!.id}`) });
    if (permissions.edit && c.archivedAt) items.push({ label: "Restore", onClick: () => setDialog({ kind: "restore", company: c }) });
    return <ActionMenu items={items} />;
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Saved view" value={activeViewId} onChange={(e) => applyView(e.target.value)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <option value="">All companies</option>
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
      <BulkActionsButton entityType="COMPANY" selectedIds={selected} filterQuery={bulkFilterQuery} onSubmitted={() => setSelected([])} />
      <CrmColumnPicker columns={ALL_COLUMNS.map((c) => ({ key: c.key, header: c.header }))} visibleKeys={visibleColumns} onChange={setVisibleColumns} />
      {permissions.create && (
        <Link href="/crm/companies/new" className={buttonClasses("primary", "sm")}>
          New company
        </Link>
      )}
    </div>
  );

  return (
    <>
      <CrmTable<CompanyRowDto>
        fetchUrl={API}
        columns={columns}
        filters={filters}
        listState={listState}
        searchPlaceholder="Search name, legal name, website, phone, email, city, ERP customer code…"
        rowHref={(c) => `/crm/companies/${c.id}`}
        rowActions={rowActions}
        refreshKey={refreshKey}
        toolbar={toolbar}
        tableKey={tableKey}
        initialSort={sort}
        onSortChange={setSort}
        selection={permissions.edit ? { selectedIds: selected, onChange: setSelected, label: (c) => c.name } : undefined}
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
            <Button size="xs" variant="secondary" disabled={selected.length !== 2} title={selected.length === 2 ? undefined : "Select exactly two companies to merge"} onClick={() => router.push(`/crm/companies/merge?ids=${selected.join(",")}`)}>
              Merge
            </Button>
            <Button size="xs" variant="danger" onClick={() => setDialog({ kind: "archive", ids: selected, label: `${selected.length} company(ies)` })}>
              Archive
            </Button>
            <BulkActionsButton entityType="COMPANY" size="xs" label="More bulk actions…" selectedIds={selected} filterQuery={bulkFilterQuery} onSubmitted={() => setSelected([])} />
          </CrmBulkBar>
        }
      />

      {dialog?.kind === "assign" && (
        <AssignOwnerModal apiBase={API} noun="company" onClose={() => setDialog(null)} users={users} target={dialog.target} currentOwnerId={dialog.ownerId} onDone={"ids" in dialog.target ? doneBulk("Assigned") : () => done()} />
      )}
      {dialog?.kind === "status" && meta && (
        <ChangeCompanyStatusModal statuses={meta.statuses} target={dialog.target} currentStatusId={dialog.statusId} onClose={() => setDialog(null)} onDone={"ids" in dialog.target ? doneBulk("Updated") : () => done()} />
      )}
      {dialog?.kind === "tags" && (
        <RecordTagsModal apiBase={API} noun="company" onClose={() => setDialog(null)} target={dialog.target} mode={dialog.mode} currentTags={dialog.tags} onDone={"ids" in dialog.target ? doneBulk("Updated") : () => done()} />
      )}
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive company?"
        message={
          dialog?.kind === "archive"
            ? `${dialog.label} will be hidden from active lists. Contacts, leads, opportunities, documents, history and the ERP customer link are kept; nothing changes in the ERP. You can restore it later.`
            : ""
        }
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "archive" && archive(dialog.ids)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore company?"
        message={dialog?.kind === "restore" ? `${dialog.company.name} will be active again.` : ""}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => dialog?.kind === "restore" && restore(dialog.company)}
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Saves the current search, filters, sort and columns. Each person still only sees the companies they have access to.</p>
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

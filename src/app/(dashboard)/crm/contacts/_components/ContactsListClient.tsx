"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { BulkActionsButton } from "@/components/bulk/BulkActionsButton";
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
import { CONTACTABILITY_CHANNELS } from "@/modules/crm/contacts/contact-registry";
import { contactFilterToParams, parseContactFilterParams } from "@/modules/crm/contacts/contact.schema";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { AssignContactModal, bulkMessage, ContactTagsModal } from "./ContactDialogs";
import type { BulkResult, ContactPermissions, ContactRowDto, TagDto } from "./contact-types";
import { useContactLookups } from "./useContactLookups";

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

export function ContactabilityBadge({ restricted }: { restricted: string[] }) {
  if (!restricted.length) return <span className="text-zinc-400">—</span>;
  if (restricted.includes("ALL")) return <CrmBadge label="Do not contact" tone="red" />;
  return <CrmBadge label={`DND: ${restricted.map((c) => CONTACTABILITY_CHANNELS[c as keyof typeof CONTACTABILITY_CHANNELS] ?? c).join(", ")}`} tone="amber" />;
}

const ALL_COLUMNS: (DataTableColumn<ContactRowDto> & { defaultVisible: boolean })[] = [
  {
    key: "fullName",
    header: "Contact",
    sortable: true,
    defaultVisible: true,
    render: (c) => (
      <div className="min-w-[9rem]">
        <Link href={`/crm/contacts/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {c.fullName}
        </Link>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {[c.designation, c.archivedAt ? "Archived" : null].filter(Boolean).join(" · ")}
          {c.duplicateFlaggedAt && <span className="ml-1 text-amber-600 dark:text-amber-400">· Possible duplicate</span>}
        </div>
      </div>
    ),
  },
  { key: "companyName", header: "Company", sortable: true, defaultVisible: true, render: (c) => (c.crmCompany ? <Link href={`/crm/companies/${c.crmCompany.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{c.crmCompany.name}</Link> : "—") },
  { key: "email", header: "Email", defaultVisible: true, render: (c) => c.email ?? "—" },
  { key: "phone", header: "Phone", defaultVisible: true, render: (c) => <span className="whitespace-nowrap">{c.mobile ?? c.phone ?? c.whatsapp ?? "—"}</span> },
  { key: "department", header: "Department", defaultVisible: false, render: (c) => c.department ?? "—" },
  { key: "owner", header: "Owner", defaultVisible: true, render: (c) => <OwnerName owner={c.owner} inactive={c.ownerInactive} /> },
  { key: "source", header: "Source", defaultVisible: false, render: (c) => c.source?.name ?? "—" },
  {
    key: "tags",
    header: "Tags",
    defaultVisible: true,
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
  { key: "contactability", header: "Contactability", defaultVisible: true, render: (c) => <ContactabilityBadge restricted={c.restrictedChannels} /> },
  { key: "lastActivityAt", header: "Last activity", sortable: true, defaultVisible: true, render: (c) => (c.lastActivityAt ? <ClientDateTime value={c.lastActivityAt} /> : "—") },
  { key: "updatedAt", header: "Updated", sortable: true, defaultVisible: false, render: (c) => <ClientDateTime value={c.updatedAt} mode="date" /> },
  { key: "createdAt", header: "Created", sortable: true, defaultVisible: true, render: (c) => <ClientDateTime value={c.createdAt} mode="date" /> },
];
const DEFAULT_COLUMNS = ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

type Dialog =
  | { kind: "assign"; target: { recordId: string; version: number } | { ids: string[] }; ownerId?: string | null }
  | { kind: "tags"; target: { recordId: string } | { ids: string[] }; mode: "edit" | "add" | "remove"; tags?: TagDto[] }
  | { kind: "archive"; ids: string[]; label: string }
  | { kind: "restore"; contact: ContactRowDto }
  | { kind: "saveView" }
  | null;

export function ContactsListClient({ permissions }: { permissions: ContactPermissions }) {
  const router = useRouter();
  const { meta, users } = useContactLookups();
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
      { type: "select", key: "sourceIds", label: "Source", options: (meta?.sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "tagIds", label: "Tag", options: tags.map((t) => ({ value: t.id, label: t.name })) },
      { type: "text", key: "companyName", label: "Company", placeholder: "Company name contains…" },
      { type: "text", key: "designation", label: "Designation" },
      { type: "text", key: "department", label: "Department" },
      { type: "text", key: "location", label: "Location", placeholder: "City, state or country" },
      {
        type: "select",
        key: "dndChannels",
        label: "Do not contact",
        anyLabel: "Any",
        options: Object.entries(CONTACTABILITY_CHANNELS).map(([value, label]) => ({ value, label: value === "ALL" ? "Contact-wide DND" : `Not contactable by ${label.toLowerCase()}` })),
      },
      { type: "select", key: "hasEmail", label: "Email", options: [{ value: "yes", label: "Has email" }, { value: "no", label: "No email" }] },
      { type: "select", key: "hasPhone", label: "Phone", options: [{ value: "yes", label: "Has phone" }, { value: "no", label: "No phone" }] },
      { type: "select", key: "erpCustomer", label: "ERP customer", options: [{ value: "linked", label: "Linked to an ERP customer" }, { value: "not_linked", label: "Not linked" }] },
      { type: "select", key: "fromLead", label: "Origin", options: [{ value: "yes", label: "Converted from a lead" }, { value: "no", label: "Created directly" }] },
      { type: "select", key: "duplicateFlagged", label: "Duplicates", options: [{ value: "true", label: "Flagged as possible duplicate" }] },
      { type: "dateRange", label: "Last activity", fromKey: "lastActivityAtFrom", toKey: "lastActivityAtTo" },
      { type: "dateRange", label: "Created", fromKey: "createdAtFrom", toKey: "createdAtTo" },
      { type: "dateRange", label: "Updated", fromKey: "updatedAtFrom", toKey: "updatedAtTo" },
      { type: "select", key: "archived", label: "Archived", anyLabel: "Active contacts only", options: [{ value: "only", label: "Archived only" }, { value: "include", label: "Active and archived" }] },
    ],
    [meta, users, tags]
  );
  const listState = useCrmListState(crmFilterKeys(filters));
  // Phase 14: the list's current filters + search, for "all matching records" bulk jobs.
  const bulkFilterQuery = new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) }).toString();

  const loadViews = () =>
    fetch("/api/v1/crm/saved-views?entityType=CONTACT")
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
      listState.replaceAll(contactFilterToParams(rest), search ?? "");
      setVisibleColumns(view.columns?.length ? view.columns.filter((k) => ALL_COLUMNS.some((c) => c.key === k)) : DEFAULT_COLUMNS);
      setSort(view.sort ?? undefined);
    }
    setTableKey(`view-${id}-${Date.now()}`);
  };

  const saveView = async (asNew: boolean) => {
    setBusy(true);
    const filterObject = parseContactFilterParams(new URLSearchParams({ ...listState.filters, ...(listState.search ? { search: listState.search } : {}) }));
    const body = { entityType: "CONTACT", name: asNew ? viewName : activeView?.name, filters: filterObject, sort: sort ?? null, columns: visibleColumns, visibility: asNew ? (viewShared ? "SHARED" : "PRIVATE") : activeView?.visibility };
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
      const res = await crmRequest(`/api/v1/crm/contacts/${ids[0]}/archive`, { method: "POST", successMessage: "Contact archived." });
      setBusy(false);
      if (res.ok) done();
      return;
    }
    const res = await crmRequest<BulkResult>("/api/v1/crm/contacts/bulk", { method: "POST", body: { action: "archive", ids }, toast: "errors" });
    setBusy(false);
    if (res.ok) doneBulk("Archived")(res.data);
  };

  const restore = async (contact: ContactRowDto) => {
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/contacts/${contact.id}/restore`, { method: "POST", successMessage: "Contact restored." });
    setBusy(false);
    if (res.ok) done();
  };

  const rowActions = (c: ContactRowDto) => {
    const items = [{ label: "View", onClick: () => router.push(`/crm/contacts/${c.id}`) }];
    if (permissions.edit && !c.archivedAt) {
      items.push(
        { label: "Edit", onClick: () => router.push(`/crm/contacts/${c.id}/edit`) },
        { label: "Assign", onClick: () => setDialog({ kind: "assign", target: { recordId: c.id, version: c.version }, ownerId: c.ownerUserId }) },
        { label: "Edit tags", onClick: () => setDialog({ kind: "tags", target: { recordId: c.id }, mode: "edit", tags: c.tags }) },
        { label: "Add note", onClick: () => router.push(`/crm/contacts/${c.id}#notes`) },
        { label: "Merge with…", onClick: () => router.push(`/crm/contacts/merge?ids=${c.id}`) },
        { label: "Archive", onClick: () => setDialog({ kind: "archive", ids: [c.id], label: c.fullName }) }
      );
    }
    if (permissions.edit && c.archivedAt) items.push({ label: "Restore", onClick: () => setDialog({ kind: "restore", contact: c }) });
    return <ActionMenu items={items} />;
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Saved view" value={activeViewId} onChange={(e) => applyView(e.target.value)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <option value="">All contacts</option>
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
      <BulkActionsButton entityType="CONTACT" selectedIds={selected} filterQuery={bulkFilterQuery} onSubmitted={() => setSelected([])} />
      <CrmColumnPicker columns={ALL_COLUMNS.map((c) => ({ key: c.key, header: c.header }))} visibleKeys={visibleColumns} onChange={setVisibleColumns} />
      {permissions.create && (
        <Link href="/crm/contacts/new" className={buttonClasses("primary", "sm")}>
          New contact
        </Link>
      )}
    </div>
  );

  return (
    <>
      <CrmTable<ContactRowDto>
        fetchUrl="/api/v1/crm/contacts"
        columns={columns}
        filters={filters}
        listState={listState}
        searchPlaceholder="Search name, email, phone, company, designation…"
        rowHref={(c) => `/crm/contacts/${c.id}`}
        rowActions={rowActions}
        refreshKey={refreshKey}
        toolbar={toolbar}
        tableKey={tableKey}
        initialSort={sort}
        onSortChange={setSort}
        selection={permissions.edit ? { selectedIds: selected, onChange: setSelected, label: (c) => c.fullName } : undefined}
        aboveTable={
          <CrmBulkBar count={selected.length} onClear={() => setSelected([])}>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "assign", target: { ids: selected } })}>
              Assign
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "tags", target: { ids: selected }, mode: "add" })}>
              Add tags
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "tags", target: { ids: selected }, mode: "remove" })}>
              Remove tags
            </Button>
            <Button size="xs" variant="secondary" disabled={selected.length !== 2} title={selected.length === 2 ? undefined : "Select exactly two contacts to merge"} onClick={() => router.push(`/crm/contacts/merge?ids=${selected.join(",")}`)}>
              Merge
            </Button>
            <Button size="xs" variant="danger" onClick={() => setDialog({ kind: "archive", ids: selected, label: `${selected.length} contact(s)` })}>
              Archive
            </Button>
            <BulkActionsButton entityType="CONTACT" size="xs" label="More bulk actions…" selectedIds={selected} filterQuery={bulkFilterQuery} onSubmitted={() => setSelected([])} />
          </CrmBulkBar>
        }
      />

      {dialog?.kind === "assign" && (
        <AssignContactModal onClose={() => setDialog(null)} users={users} target={dialog.target} currentOwnerId={dialog.ownerId} onDone={"ids" in dialog.target ? doneBulk("Assigned") : () => done()} />
      )}
      {dialog?.kind === "tags" && <ContactTagsModal onClose={() => setDialog(null)} target={dialog.target} mode={dialog.mode} currentTags={dialog.tags} onDone={"ids" in dialog.target ? doneBulk("Updated") : () => done()} />}
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive contact?"
        message={dialog?.kind === "archive" ? `${dialog.label} will be hidden from active lists. History, notes, documents and tags are kept, and you can restore it later.` : ""}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "archive" && archive(dialog.ids)}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore contact?"
        message={dialog?.kind === "restore" ? `${dialog.contact.fullName} will be active again.` : ""}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => dialog?.kind === "restore" && restore(dialog.contact)}
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Saves the current search, filters, sort and columns. Each person still only sees the contacts they have access to.</p>
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

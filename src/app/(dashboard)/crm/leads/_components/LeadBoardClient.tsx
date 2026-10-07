"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmColumnPicker } from "@/components/crm/CrmColumnPicker";
import { formatCustomFieldValue } from "@/components/crm/CrmCustomFields";
import { CrmFilterBar, crmFilterKeys } from "@/components/crm/CrmFilterBar";
import { crmRequest, type CrmApiError } from "@/components/crm/crm-api";
import { CardFieldList, CrmKanbanBoard, type KanbanColumn, type KanbanMoveResult, type KanbanNotice } from "@/components/crm/CrmKanbanBoard";
import { useCrmListState } from "@/components/crm/useCrmListState";
import type { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatCurrency } from "@/lib/currency";
import { ConvertLeadDrawer } from "./ConvertLeadDrawer";
import { LeadTemperatureBadge, OwnerName } from "./LeadBadges";
import { AssignLeadModal, ChangeStatusModal } from "./LeadDialogs";
import type { LeadDetailDto, LeadMetaDto, LeadPermissions, LeadRowDto, UserRefDto } from "./lead-types";
import { useLeadFilters } from "./useLeadFilters";

const LEAD_API = "/api/v1/crm/leads";
const PER_STATUS = 20;

export type LeadCardDto = LeadRowDto & { customFields?: Record<string, unknown> | null };
export interface LeadBoardColumnDto extends KanbanColumn<LeadCardDto> {
  kind: "OPEN" | "CONVERTED" | "LOST";
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  values: { currencyCode: string | null; total: number; average: number | null }[];
}
export interface LeadBoardDto {
  statuses: LeadBoardColumnDto[];
}

interface CardField {
  key: string;
  header: string;
  render: (l: LeadCardDto) => ReactNode;
}
const value = (amount: string | number | null | undefined, currency: string | null | undefined) =>
  amount === null || amount === undefined || amount === "" ? null : `${currency ?? ""} ${formatCurrency(String(amount))}`.trim();

const BASE_CARD_FIELDS: CardField[] = [
  { key: "company", header: "Company", render: (l) => l.crmCompany?.name ?? l.companyName },
  { key: "phone", header: "Phone", render: (l) => l.phone ?? l.mobile ?? l.whatsapp },
  { key: "email", header: "Email", render: (l) => l.email },
  { key: "source", header: "Source", render: (l) => l.source?.name ?? null },
  { key: "owner", header: "Owner", render: (l) => <OwnerName owner={l.owner} inactive={l.ownerInactive} /> },
  { key: "estimatedValue", header: "Est. value", render: (l) => value(l.estimatedValue, l.currencyCode) },
  { key: "temperature", header: "Temperature", render: (l) => (l.temperature ? <LeadTemperatureBadge temperature={l.temperature} /> : null) },
  { key: "score", header: "Score", render: (l) => (l.score ? String(l.score) : null) },
  {
    key: "nextFollowUpAt",
    header: "Follow-up",
    render: (l) =>
      l.nextFollowUpAt ? (
        <span className={new Date(l.nextFollowUpAt) < new Date() && !l.convertedAt ? "font-medium text-red-600 dark:text-red-400" : undefined}>
          <ClientDateTime value={l.nextFollowUpAt} />
        </span>
      ) : null,
  },
  { key: "lastContactedAt", header: "Last contact", render: (l) => (l.lastContactedAt ? <ClientDateTime value={l.lastContactedAt} /> : null) },
  {
    key: "tags",
    header: "Tags",
    render: (l) =>
      l.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {l.tags.map((t) => (
            <CrmBadge key={t.id} label={t.name} />
          ))}
        </span>
      ) : null,
  },
  { key: "createdAt", header: "Created", render: (l) => <ClientDateTime value={l.createdAt} mode="date" /> },
];
export const DEFAULT_LEAD_CARD_FIELDS = ["company", "phone", "source", "owner", "estimatedValue", "temperature", "nextFollowUpAt", "tags"];

const money = (values: LeadBoardColumnDto["values"], pick: "total" | "average") =>
  values
    .filter((v) => v[pick] !== null)
    .map((v) => value(v[pick], v.currencyCode))
    .join(" + ");

/** A refused status change, as the board shows it (the server's answer, unchanged). */
export function leadMoveFailureNotice(error: CrmApiError): KanbanNotice {
  if (error.code === "RECORD_VERSION_CONFLICT" || error.status === 409) return { kind: "conflict" };
  return { kind: "error", message: error.fieldErrors.statusId && error.fieldErrors.statusId !== error.message ? `${error.message} ${error.fieldErrors.statusId}` : error.message };
}

type Dialog = { kind: "status"; lead: LeadCardDto } | { kind: "assign"; lead: LeadCardDto } | { kind: "archive"; lead: LeadCardDto } | null;

/**
 * Lead Board: one column per lead status, the lead list's filters (server-side),
 * per-column paging and server totals. Dropping a card calls the existing
 * POST /leads/{id}/status with the lead's version — the server decides; a
 * refused move puts the card back. Dropping on a "Converted" status opens the
 * existing Convert flow instead (conversion creates/links the contact, company
 * and opportunity, which a status change alone must never do).
 */
export function LeadBoardClient({
  permissions,
  meta,
  users,
  preferences,
}: {
  permissions: LeadPermissions;
  meta: LeadMetaDto;
  users: UserRefDto[];
  preferences: ReturnType<typeof useCrmPreferences>;
}) {
  const router = useRouter();
  const { prefs, setPreference } = preferences;
  const { filters } = useLeadFilters({ meta, users, board: true });
  const listState = useCrmListState(crmFilterKeys(filters));
  const [searchDraft, setSearchDraft] = useState(listState.search);

  const customFieldDefs = useMemo(() => meta.customFields.filter((d) => d.isActive), [meta.customFields]);
  const cardFieldOptions: CardField[] = useMemo(
    () => [
      ...BASE_CARD_FIELDS,
      ...customFieldDefs.map((d) => ({
        key: `cf:${d.key}`,
        header: d.label,
        render: (l: LeadCardDto) => {
          const v = formatCustomFieldValue(d, l.customFields?.[d.key]);
          return v === "—" ? null : v;
        },
      })),
    ],
    [customFieldDefs]
  );
  const cardFieldKeys = (prefs["leads.board.cardFields"] ?? DEFAULT_LEAD_CARD_FIELDS).filter((k) => cardFieldOptions.some((f) => f.key === k));
  const cardFields = cardFieldOptions.filter((f) => cardFieldKeys.includes(f.key));

  const queryParams = new URLSearchParams({ perStatus: String(PER_STATUS) });
  for (const [k, v] of Object.entries(listState.filters)) if (v) queryParams.set(k, v);
  if (listState.search) queryParams.set("search", listState.search);
  const query = `${LEAD_API}/board?${queryParams}`;
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // ── Convert (dropping on a Converted status, or the card menu) ──
  const [converting, setConverting] = useState<LeadDetailDto | null>(null);
  const openConvert = async (lead: LeadCardDto): Promise<KanbanMoveResult> => {
    const res = await crmRequest<LeadDetailDto>(`${LEAD_API}/${lead.id}`, { toast: "off" });
    if (!res.ok) return { ok: false, notice: { kind: "error", message: res.error.message } };
    setConverting(res.data);
    return { ok: false, notice: null };
  };

  const move = async (lead: LeadCardDto, _from: LeadBoardColumnDto, to: LeadBoardColumnDto): Promise<KanbanMoveResult> => {
    if (to.kind === "CONVERTED" && !lead.convertedAt) return openConvert(lead);
    const res = await crmRequest(`${LEAD_API}/${lead.id}/status`, { method: "POST", body: { statusId: to.id, version: lead.version }, toast: "off" });
    return res.ok ? { ok: true } : { ok: false, notice: leadMoveFailureNotice(res.error) };
  };

  // ── Card actions ──
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const done = () => {
    setDialog(null);
    reload();
  };
  const archive = async (lead: LeadCardDto) => {
    setBusy(true);
    const res = await crmRequest(`${LEAD_API}/${lead.id}/archive`, { method: "POST", successMessage: "Lead archived." });
    setBusy(false);
    if (res.ok) done();
  };
  const cardActions = (l: LeadCardDto): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [{ label: "Open", onClick: () => router.push(`/crm/leads/${l.id}`) }];
    if (permissions.edit) {
      items.push(
        { label: "Edit", onClick: () => router.push(`/crm/leads/${l.id}/edit`) },
        { label: "Change status", onClick: () => setDialog({ kind: "status", lead: l }), disabled: Boolean(l.convertedAt) },
        { label: "Assign owner", onClick: () => setDialog({ kind: "assign", lead: l }) },
        { label: "Convert", onClick: () => void openConvert(l), disabled: Boolean(l.convertedAt) },
        { label: "Archive", onClick: () => setDialog({ kind: "archive", lead: l }), danger: true }
      );
    }
    return items;
  };

  const summary = (columns: LeadBoardColumnDto[]) => {
    const count = columns.reduce((n, c) => n + c.count, 0);
    const totals = new Map<string | null, number>();
    for (const c of columns) for (const v of c.values) totals.set(v.currencyCode, (totals.get(v.currencyCode) ?? 0) + v.total);
    const totalValues = [...totals.entries()].map(([currencyCode, total]) => ({ currencyCode, total: Math.round(total * 100) / 100, average: null }));
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300" aria-live="polite">
        <span className="font-medium">{count}</span> {count === 1 ? "lead" : "leads"}
        {totalValues.length > 0 && <> · estimated value {money(totalValues, "total")}</>}
      </p>
    );
  };

  const header = (c: LeadBoardColumnDto) => (
    <dl className="mt-1 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
      {c.values.length ? (
        <>
          <div className="flex justify-between gap-2">
            <dt>Est. value</dt>
            <dd className="text-right font-medium text-zinc-700 dark:text-zinc-200">{money(c.values, "total")}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Average</dt>
            <dd className="text-right">{money(c.values, "average")}</dd>
          </div>
        </>
      ) : (
        <div>No value</div>
      )}
      {c.kind === "CONVERTED" && <div>Drop a lead here to convert it</div>}
      {c.kind === "LOST" && <div>Closed status</div>}
    </dl>
  );

  const card = (l: LeadCardDto, _c: LeadBoardColumnDto, saving: boolean) => (
    <>
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <Link href={`/crm/leads/${l.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" draggable={false}>
            {l.fullName}
          </Link>
          <div className="text-xs text-zinc-400">
            {l.leadNumber}
            {l.convertedAt && " · converted"}
            {saving && " · saving…"}
          </div>
        </div>
        <ActionMenu items={cardActions(l)} />
      </div>
      <CardFieldList fields={cardFields} record={l} />
    </>
  );

  const filtered = Boolean(listState.search) || Object.values(listState.filters).some(Boolean);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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
            aria-label="Search leads"
            value={searchDraft}
            onChange={(e) => {
              setSearchDraft(e.target.value);
              if (!e.target.value && listState.search) listState.setSearch("");
            }}
            placeholder="Search name, phone, email, company, lead #…"
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
        </form>
        <CrmColumnPicker label="Card fields" columns={cardFieldOptions.map((f) => ({ key: f.key, header: f.header }))} visibleKeys={cardFieldKeys} onChange={(keys) => setPreference("leads.board.cardFields", keys)} />
        <Button size="sm" variant="secondary" onClick={reload}>
          Refresh
        </Button>
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

      <CrmFilterBar definitions={filters} value={listState.filters} onApply={listState.applyFilters} onClearAll={listState.clearFilters} isOpen={listState.isFilterPanelOpen} onToggleOpen={listState.toggleFilterPanel} />

      <CrmKanbanBoard<LeadCardDto, LeadBoardColumnDto>
        query={query}
        columnsOf={(data) => (data as LeadBoardDto).statuses}
        pageQuery={(column, offset) => `${query}&statusId=${column.id}&offset=${offset}`}
        reloadKey={reloadKey}
        canDrag={permissions.edit}
        columnNoun="status"
        recordNoun="Lead"
        recordNounPlural="leads"
        recordHref={(l) => `/crm/leads/${l.id}`}
        cardTitle={(l) => l.fullName}
        renderHeader={header}
        renderCard={card}
        onMove={move}
        optimistic={(l, to) => ({ ...l, status: { ...l.status, id: to.id, name: to.name, kind: to.kind, color: to.color } })}
        renderSummary={summary}
        emptyMessage={filtered ? "No leads match this search and these filters." : "No leads yet."}
      />

      {dialog?.kind === "status" && (
        <ChangeStatusModal open onClose={() => setDialog(null)} statuses={meta.statuses} target={{ leadId: dialog.lead.id, version: dialog.lead.version }} currentStatusId={dialog.lead.status.id} onDone={done} />
      )}
      {dialog?.kind === "assign" && (
        <AssignLeadModal open onClose={() => setDialog(null)} users={users} target={{ leadId: dialog.lead.id, version: dialog.lead.version }} currentOwnerId={dialog.lead.ownerUserId} onDone={done} />
      )}
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive lead?"
        message={dialog?.kind === "archive" ? `${dialog.lead.fullName} will be hidden from the board and active lists. History, notes and tags are kept, and you can restore it later.` : ""}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "archive" && archive(dialog.lead)}
        onCancel={() => setDialog(null)}
      />
      {converting && (
        <ConvertLeadDrawer
          open
          lead={converting}
          onClose={() => setConverting(null)}
          onDone={() => {
            setConverting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

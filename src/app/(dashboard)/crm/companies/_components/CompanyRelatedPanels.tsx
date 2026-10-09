"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { formatCurrency } from "@/lib/currency";
import { OpportunityStatusBadge, opportunityValue } from "../../opportunities/_components/OpportunityBadges";
import { COMPANY_FUTURE_SECTIONS } from "@/modules/crm/companies/company-registry";

/**
 * Paged related-record lists for the company page (each list is its own
 * server-side page: no unbounded loads, no N+1).
 */

interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

const linkClass = "font-medium text-indigo-600 hover:underline dark:text-indigo-400";
const smallButton = "text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400";
const pagerButton = "rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200";
const PAGE_SIZE = 10;

function Pager({ meta, page, setPage }: { meta: Paged<unknown>["meta"]; page: number; setPage: (p: number) => void }) {
  if (meta.totalPages <= 1) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
      <button type="button" className={pagerButton} disabled={page <= 1} onClick={() => setPage(page - 1)}>
        ‹ Prev
      </button>
      <span>
        Page {page} of {meta.totalPages} · {meta.totalCount} total
      </span>
      <button type="button" className={pagerButton} disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}

function ListShell<T>({ state, empty, render }: { state: ReturnType<typeof usePaged<T>>; empty: string; render: (rows: T[]) => ReactNode }) {
  if (state.error) return <CrmErrorState message={state.error} onRetry={state.retry} />;
  if (!state.result) return <CrmLoadingState />;
  if (!Array.isArray(state.result.data) || state.result.data.length === 0) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>;
  return (
    <>
      {render(state.result.data)}
      <Pager meta={state.result.meta} page={state.page} setPage={state.setPage} />
    </>
  );
}

/** Paged endpoints return { data, meta }; fetched raw (crmRequest unwraps `data`) to keep `meta`. */
async function fetchPaged<T>(url: string): Promise<{ ok: true; data: Paged<T> } | { ok: false; message: string }> {
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: json?.message ?? json?.error?.message ?? "Could not load." };
    return { ok: true, data: json as Paged<T> };
  } catch {
    return { ok: false, message: "Couldn't reach the server." };
  }
}

function usePaged<T>(url: string, refreshKey: number, includeArchived = false) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchPaged<T>(`${url}?page=${page}&pageSize=${PAGE_SIZE}${includeArchived ? "&includeArchived=true" : ""}`).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setError(res.message);
      setError(null);
      setResult(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [url, page, refreshKey, tick, includeArchived]);
  return { page, setPage, result, error, retry: () => setTick((t) => t + 1) };
}

export interface CompanyContactRow {
  id: string;
  fullName: string;
  designation: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  lastActivityAt: string | null;
  archivedAt: string | null;
  owner: { id: string; fullName: string } | null;
  isPrimary: boolean;
}

export function CompanyContactsList({
  companyId,
  refreshKey,
  canEdit,
  onSetPrimary,
  onRemove,
}: {
  companyId: string;
  refreshKey: number;
  canEdit: boolean;
  onSetPrimary: (c: CompanyContactRow) => void;
  onRemove: (c: CompanyContactRow) => void;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const state = usePaged<CompanyContactRow>(`/api/v1/crm/companies/${companyId}/contacts`, refreshKey, includeArchived);
  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Show archived contacts
      </label>
      <ListShell
        state={state}
        empty="No contacts yet."
        render={(rows) => (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/crm/contacts/${c.id}`} className={linkClass}>
                    {c.fullName}
                  </Link>{" "}
                  {c.isPrimary && <CrmBadge label="Primary" tone="green" />} {c.archivedAt && <CrmBadge label="Archived" tone="neutral" />}
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{[c.designation, c.email, c.mobile ?? c.phone, c.owner ? `Owner: ${c.owner.fullName}` : null].filter(Boolean).join(" · ")}</span>
                </span>
                {canEdit && !c.archivedAt && (
                  <span className="flex gap-3">
                    {!c.isPrimary && (
                      <button type="button" className={smallButton} onClick={() => onSetPrimary(c)}>
                        Set primary
                      </button>
                    )}
                    <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => onRemove(c)}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}

export interface CompanyLeadRow {
  id: string;
  leadNumber: string;
  fullName: string;
  score: number;
  estimatedValue: string | null;
  currencyCode: string | null;
  convertedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  status: { name: string; color: string | null } | null;
  source: { name: string } | null;
  owner: { id: string; fullName: string } | null;
}

export function CompanyLeadsList({ companyId, refreshKey, canEdit, onUnlink }: { companyId: string; refreshKey: number; canEdit: boolean; onUnlink: (l: CompanyLeadRow) => void }) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const state = usePaged<CompanyLeadRow>(`/api/v1/crm/companies/${companyId}/leads`, refreshKey, includeArchived);
  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Show archived leads
      </label>
      <ListShell
        state={state}
        empty="No leads associated."
        render={(rows) => (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/crm/leads/${l.id}`} className={linkClass}>
                    {l.leadNumber}
                  </Link>{" "}
                  {l.fullName} {l.status && <CrmBadge label={l.status.name} tone="neutral" />} {l.convertedAt && <CrmBadge label="Converted" tone="green" />} {l.archivedAt && <CrmBadge label="Archived" tone="neutral" />}
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {[l.source?.name, l.estimatedValue ? `${l.currencyCode ?? ""} ${formatCurrency(l.estimatedValue)}`.trim() : null, l.owner ? `Owner: ${l.owner.fullName}` : null].filter(Boolean).join(" · ")} · <ClientDateTime value={l.createdAt} mode="date" />
                  </span>
                </span>
                {canEdit && !l.archivedAt && (
                  <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => onUnlink(l)}>
                    Unlink
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}

interface CompanyOpportunityRow {
  id: string;
  opportunityNumber: string;
  name: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  createdAt: string;
  owner: { id: string; fullName: string } | null;
  crmContact: { id: string; fullName: string } | null;
  pipeline: { id: string; name: string } | null;
  stage: { id: string; name: string } | null;
}

export function CompanyOpportunitiesList({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const state = usePaged<CompanyOpportunityRow>(`/api/v1/crm/companies/${companyId}/opportunities`, refreshKey);
  return (
    <ListShell
      state={state}
      empty="No opportunities yet."
      render={(rows) => (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((o) => (
            <li key={o.id} className="py-2 text-sm">
              <Link href={`/crm/opportunities/${o.id}`} className={linkClass}>
                {o.opportunityNumber}
              </Link>{" "}
              {o.name} <OpportunityStatusBadge status={o.status} />
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {[o.stage?.name, opportunityValue(o.amount, o.currencyCode), o.probability !== null ? `${o.probability}%` : null, o.expectedCloseDate ? `Close ${o.expectedCloseDate.slice(0, 10)}` : null, o.crmContact?.fullName, o.owner ? `Owner: ${o.owner.fullName}` : null]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    />
  );
}

export function CompanyUpcomingSections() {
  return (
    <ul className="space-y-1.5 text-sm">
      {COMPANY_FUTURE_SECTIONS.map((s) => (
        <li key={s.key}>
          <span className="text-zinc-800 dark:text-zinc-100">{s.title}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Arrives with {s.phase}.</span>
        </li>
      ))}
    </ul>
  );
}


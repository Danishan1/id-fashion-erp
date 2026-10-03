"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { formatCurrency } from "@/lib/currency";
import { humanizeStatus } from "@/lib/humanize-status";
import { CONTACT_FUTURE_SECTIONS } from "@/modules/crm/contacts/contact-registry";

const money = (amount: string | null, currency: string | null) => (amount ? `${currency ?? ""} ${formatCurrency(amount)}`.trim() : null);
const label = "text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400";

function useLoad<T>(url: string, refreshKey?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    crmRequest<T>(url).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [url, refreshKey, tick]);
  return { data, error, retry: () => setTick((t) => t + 1) };
}

interface RelatedDto {
  leads: { id: string; leadNumber: string; fullName: string; convertedAt: string | null; archivedAt: string | null; createdAt: string; status: { name: string; color: string | null } }[];
  opportunities: { id: string; opportunityNumber: string; name: string; status: string; amount: string | null; currencyCode: string | null; createdAt: string }[];
}

/** Leads and opportunities linked to the contact (and to contacts merged into it). */
export function ContactRelatedRecords({ contactId, refreshKey }: { contactId: string; refreshKey?: number }) {
  const { data, error, retry } = useLoad<RelatedDto>(`/api/v1/crm/contacts/${contactId}/related`, refreshKey);
  if (error) return <CrmErrorState message={error} onRetry={retry} />;
  if (!data) return <CrmLoadingState />;
  const tones = new Set(["neutral", "indigo", "green", "amber", "red"]);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className={label}>Leads</p>
        {data.leads.length === 0 ? (
          <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">None linked.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {data.leads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/crm/leads/${l.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {l.leadNumber}
                </Link>
                <span className="text-zinc-700 dark:text-zinc-200">{l.fullName}</span>
                <CrmBadge label={l.status.name} tone={(l.status.color && tones.has(l.status.color) ? l.status.color : "neutral") as CrmBadgeTone} />
                {l.archivedAt && <span className="text-xs text-zinc-500">archived</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className={label}>Opportunities</p>
        {data.opportunities.length === 0 ? (
          <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {data.opportunities.map((o) => (
              <li key={o.id}>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{o.opportunityNumber}</span> · {o.name}
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{[humanizeStatus(o.status), money(o.amount, o.currencyCode)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Opportunity pages arrive with Phase 06.</p>
      </div>
    </div>
  );
}

/** Sections whose data arrives in later phases — an honest placeholder, never sample data. */
export function ContactUpcomingSections() {
  return (
    <ul className="space-y-2 text-sm">
      {CONTACT_FUTURE_SECTIONS.map((u) => (
        <li key={u.key} className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-zinc-800 dark:text-zinc-100">{u.title}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Arrives with {u.phase}</span>
        </li>
      ))}
    </ul>
  );
}

interface ErpRow {
  id: string;
  number: string;
  date: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  href: string;
}
type ErpDto =
  | { linked: false; crmCompany: { id: string; name: string } | null; reason: string }
  | {
      linked: true;
      crmCompany: { id: string; name: string } | null;
      customer: { id: string; code: string; name: string; type: string; country: string | null; city: string | null; href: string | null } | null;
      sections: { key: string; label: string; allowed: boolean; total: number; rows: ErpRow[] }[];
      notAvailable: { key: string; label: string; reason: string }[];
    };

/** Read-only references to the customer's ERP documents. The ERP stays the system of record. */
export function ContactErpReferences({ contactId }: { contactId: string }) {
  const { data, error, retry } = useLoad<ErpDto>(`/api/v1/crm/contacts/${contactId}/erp-references`);
  if (error) return <CrmErrorState message={error} onRetry={retry} />;
  if (!data) return <CrmLoadingState />;
  if (!data.linked) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{data.reason}</p>;
  return (
    <div className="space-y-4 text-sm">
      {data.customer && (
        <div>
          <p className={label}>ERP customer</p>
          <p className="mt-0.5">
            {data.customer.href ? (
              <Link href={data.customer.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                {data.customer.name}
              </Link>
            ) : (
              <span className="font-medium">{data.customer.name}</span>
            )}{" "}
            <span className="text-xs text-zinc-500">({[data.customer.code, data.customer.city, data.customer.country].filter(Boolean).join(" · ")})</span>
          </p>
        </div>
      )}
      {data.sections.map((s) => (
        <div key={s.key}>
          <p className={label}>
            {s.label}
            {s.allowed && s.total > 0 && <span className="ml-1 font-normal normal-case">({s.total > s.rows.length ? `latest ${s.rows.length} of ${s.total}` : s.total})</span>}
          </p>
          {!s.allowed ? (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">You don&apos;t have access to {s.label.toLowerCase()}.</p>
          ) : s.rows.length === 0 ? (
            <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">None.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {s.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={r.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {r.number}
                  </Link>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    <ClientDateTime value={r.date} mode="date" /> · {humanizeStatus(r.status)}
                    {money(r.amount, r.currencyCode) ? ` · ${money(r.amount, r.currencyCode)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {data.notAvailable.map((n) => (
        <div key={n.key}>
          <p className={label}>{n.label}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{n.reason}</p>
        </div>
      ))}
    </div>
  );
}

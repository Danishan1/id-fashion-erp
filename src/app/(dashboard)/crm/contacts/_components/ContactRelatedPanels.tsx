"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErpReferencesPanel } from "@/components/crm/CrmErpReferencesPanel";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
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

/** Read-only ERP references through the contact's company (shared panel). */
export function ContactErpReferences({ contactId }: { contactId: string }) {
  return <CrmErpReferencesPanel url={`/api/v1/crm/contacts/${contactId}/erp-references`} />;
}

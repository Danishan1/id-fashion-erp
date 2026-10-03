"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { crmRequest } from "./crm-api";
import { CrmErrorState, CrmLoadingState } from "./CrmStates";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { formatCurrency } from "@/lib/currency";
import { humanizeStatus } from "@/lib/humanize-status";

export interface ErpRowDto {
  id: string;
  number: string;
  date: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  outstanding: string | null;
  dueDate: string | null;
  person: string | null;
  href: string;
}
export interface ErpSectionDto {
  key: string;
  label: string;
  allowed: boolean;
  total: number;
  rows: ErpRowDto[];
  page: number;
  pageSize: number;
}
export type ErpReferencesDto =
  | { linked: false; crmCompany: { id: string; name: string } | null; reason: string }
  | {
      linked: true;
      crmCompany: { id: string; name: string } | null;
      customer: { id: string; code: string; name: string; type: string; city: string | null; country: string | null; status: string; href: string | null } | null;
      sections: ErpSectionDto[];
      notAvailable: { key: string; label: string; reason: string }[];
    };

const money = (amount: string | null, currency: string | null) => (amount ? `${currency ?? ""} ${formatCurrency(amount)}`.trim() : null);
const labelClass = "text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400";
const pagerButton = "rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200";

/** One ERP section with its own server-side paging (?section=&page=). */
function ErpSection({ url, initial }: { url: string; initial: ErpSectionDto }) {
  const [section, setSection] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pages = Math.max(1, Math.ceil(section.total / section.pageSize));

  const go = async (page: number) => {
    setBusy(true);
    const res = await crmRequest<Extract<ErpReferencesDto, { linked: true }>>(`${url}?section=${section.key}&page=${page}&pageSize=${section.pageSize}`);
    setBusy(false);
    if (res.ok && res.data.linked && res.data.sections[0]) setSection(res.data.sections[0]);
  };

  return (
    <div>
      <p className={labelClass}>
        {section.label}
        {section.allowed && section.total > 0 && <span className="ml-1 font-normal normal-case">({section.total})</span>}
      </p>
      {!section.allowed ? (
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">You don&apos;t have access to {section.label.toLowerCase()}.</p>
      ) : section.rows.length === 0 ? (
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">None.</p>
      ) : (
        <>
          <ul className={`mt-1 space-y-1 ${busy ? "opacity-50" : ""}`}>
            {section.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <Link href={r.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {r.number}
                </Link>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  <ClientDateTime value={r.date} mode="date" /> · {humanizeStatus(r.status)}
                  {money(r.amount, r.currencyCode) ? ` · ${money(r.amount, r.currencyCode)}` : ""}
                  {r.outstanding && Number(r.outstanding) > 0 ? ` · due ${money(r.outstanding, r.currencyCode)}` : ""}
                  {r.person ? ` · ${r.person}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
              <button type="button" className={pagerButton} disabled={busy || section.page <= 1} onClick={() => go(section.page - 1)}>
                ‹ Prev
              </button>
              <span>
                Page {section.page} of {pages}
              </span>
              <button type="button" className={pagerButton} disabled={busy || section.page >= pages} onClick={() => go(section.page + 1)}>
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Read-only references to the ERP customer's documents (orders, invoices,
 * receipts, enquiries). The ERP stays the system of record; each section is
 * shown only with that ERP module's permission. `url` is the record's
 * erp-references endpoint.
 */
export function CrmErpReferencesPanel({ url, refreshKey }: { url: string; refreshKey?: number }) {
  const [data, setData] = useState<ErpReferencesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    crmRequest<ErpReferencesDto>(url).then((res) => {
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

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!data) return <CrmLoadingState />;
  if (!data.linked) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{data.reason}</p>;
  return (
    <div className="space-y-4 text-sm">
      {data.customer && (
        <div>
          <p className={labelClass}>ERP customer</p>
          <p className="mt-0.5">
            {data.customer.href ? (
              <Link href={data.customer.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                {data.customer.name}
              </Link>
            ) : (
              <span className="font-medium">{data.customer.name}</span>
            )}{" "}
            <span className="text-xs text-zinc-500">({[data.customer.code, data.customer.city, data.customer.country, humanizeStatus(data.customer.status)].filter(Boolean).join(" · ")})</span>
          </p>
        </div>
      )}
      {data.sections.map((s) => (
        <ErpSection key={`${s.key}-${tick}-${refreshKey ?? 0}`} url={url} initial={s} />
      ))}
      {data.notAvailable.map((n) => (
        <div key={n.key}>
          <p className={labelClass}>{n.label}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{n.reason}</p>
        </div>
      ))}
    </div>
  );
}

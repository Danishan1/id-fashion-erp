"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/PageStates";
import {
  SALES_MARKETING_AREAS,
  type SalesMarketingSection,
} from "@/modules/sales-marketing/sales-marketing-sections";
import type { SalesMarketingOverview } from "@/modules/sales-marketing/sales-marketing-overview.service";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SalesMarketingOverview };

const panelClass = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const headingClass = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";

export function SalesMarketingDashboardClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/sales-marketing/overview")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "error", message: body?.error?.message ?? "Could not load the Sales & Marketing dashboard." });
          return;
        }
        setState({ status: "ready", data: body.data as SalesMarketingOverview });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Could not reach the server. Check your connection and try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={retry} />;

  const { sections, connectedSources } = state.data;

  return (
    <div className="space-y-6">
      <section className={panelClass} aria-labelledby="sm-kpis">
        <h2 id="sm-kpis" className={headingClass}>
          Sales &amp; marketing KPIs
        </h2>
        <div className="mt-3">
          <EmptyState
            title="Not available yet"
            description="Enquiry, quotation, conversion and campaign figures will appear here once Sales Enquiries and Quotations are built (Phase 02). Nothing is shown until there is real data."
          />
        </div>
      </section>

      <section className={panelClass} aria-labelledby="sm-sources">
        <h2 id="sm-sources" className={headingClass}>
          Existing ERP data this module builds on
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Live figures from other modules you have access to.</p>
        {connectedSources.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No related modules available" description="You don't have access to Customers, Buyer Enquiries, Sales Orders or CRM." />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {connectedSources.map((source) => (
              <Link
                key={source.key}
                href={source.href}
                className="flex flex-col rounded-md border border-zinc-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-zinc-800 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
              >
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{source.label}</span>
                {source.metrics.length > 0 && (
                  <dl className="mt-2 space-y-1">
                    {source.metrics.map((m) => (
                      <div key={m.label} className="flex items-baseline justify-between gap-2">
                        <dt className="text-xs text-zinc-500 dark:text-zinc-400">{m.label}</dt>
                        <dd className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{m.value.toLocaleString("en-IN")}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <span className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{source.description}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className={panelClass} aria-labelledby="sm-map">
        <h2 id="sm-map" className={headingClass}>
          Module sections
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Each section is built in its own phase and appears in the sidebar when it is ready.</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {SALES_MARKETING_AREAS.map((area) => {
            const items = sections.filter((s) => s.area === area.key);
            if (items.length === 0) return null;
            return (
              <div key={area.key}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{area.label}</h3>
                <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                  {items.map((section) => (
                    <SectionRow key={section.key} section={section} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SectionRow({ section }: { section: SalesMarketingSection }) {
  const available = section.status === "AVAILABLE" && section.href;
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        {available ? (
          <Link href={section.href!} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {section.label}
          </Link>
        ) : (
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{section.label}</span>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{section.description}</p>
      </div>
      <span
        className={
          available
            ? "shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        }
      >
        {available ? "Available" : `Planned · Phase ${String(section.phase).padStart(2, "0")}`}
      </span>
    </li>
  );
}

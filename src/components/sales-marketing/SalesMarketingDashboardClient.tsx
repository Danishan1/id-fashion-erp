"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { PERIOD_PRESETS } from "@/modules/sales-marketing/analytics/analytics-periods";
import type { HealthItem, KpiTile, QueueItem, SalesMarketingHome, Tile } from "@/modules/sales-marketing/sales-marketing-home.service";
import { AnalyticsChart } from "./analytics/AnalyticsChart";
import { ChangeChip, FreshnessBadges, formatValue, useApi, type ReportResult } from "./analytics/analytics-ui";

/**
 * Sales & Marketing dashboard — the module's home. Headline KPIs vs the
 * previous period, bookings trend and funnel, the work queue, team & targets
 * and system health. Every number is a governed metric (the same as in
 * Analytics) in the viewer's own scope; a tile the viewer can't see says so
 * instead of showing zero.
 */

const panel = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const heading = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";

type HiddenKpi = Omit<KpiTile, "value" | "previous" | "change"> & { hidden: string };
const isHidden = (k: KpiTile | HiddenKpi): k is HiddenKpi => "hidden" in k;

/** Builder link carrying the tile's exact governed query. */
export const builderHref = (query: unknown) => `/sales-marketing/analytics?tab=builder&q=${encodeURIComponent(JSON.stringify(query))}`;

export function SalesMarketingDashboardClient() {
  const [preset, setPreset] = useState("this_month");
  const home = useApi<SalesMarketingHome>(`/api/v1/sales-marketing/home?preset=${preset}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <select aria-label="Period" className={textInputClass()} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.entries(PERIOD_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {home.data && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {home.data.period.from} to {home.data.period.to} · compared with the previous period of the same length · India dates · amounts in base currency · updated <ClientDateTime value={home.data.generatedAt} />
          </span>
        )}
      </div>
      {home.error && <ErrorState message={home.error} onRetry={home.reload} />}
      {!home.data && !home.error && <LoadingState label="Loading the dashboard…" />}
      {home.data && <Home data={home.data} />}
    </div>
  );
}

function Home({ data }: { data: SalesMarketingHome }) {
  return (
    <>
      <section aria-label="Headline figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.kpis.map((k) => (
          <Kpi key={k.key} k={k} canOpenAnalytics={data.canOpenAnalytics} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className={`${panel} xl:col-span-2`} aria-labelledby="sm-trend">
          <h2 id="sm-trend" className={heading}>
            Bookings
          </h2>
          <p className="mb-2 text-xs text-zinc-500">Booked Sales Order value and count over the period.</p>
          <TileBody tile={data.trend} render={(r) => <AnalyticsChart result={r} kind="line" />} />
        </section>
        <section className={panel} aria-labelledby="sm-queue">
          <h2 id="sm-queue" className={heading}>
            Needs your attention
          </h2>
          <WorkQueue items={data.queue} />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className={panel} aria-labelledby="sm-funnel">
          <h2 id="sm-funnel" className={heading}>
            Enquiry funnel
          </h2>
          <p className="mb-2 text-xs text-zinc-500">Enquiries received in the period and how far each has got.</p>
          <TileBody tile={data.funnel} render={(r) => <AnalyticsChart result={r} kind="funnel" />} />
        </section>
        <section className={`${panel} xl:col-span-2`} aria-labelledby="sm-team">
          <h2 id="sm-team" className={heading}>
            Team &amp; targets
          </h2>
          <div className="mt-2 grid gap-4 md:grid-cols-3">
            <Ranking title="Top sales reps" tile={data.team.byRep} />
            <Ranking title="Top channels" tile={data.team.byChannel} />
            <Ranking title="Top customers" tile={data.team.byCustomer} />
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Targets in the period (lowest attainment first)</h3>
            <TileBody tile={data.team.targets} render={(r) => <Targets result={r} />} />
          </div>
        </section>
      </div>

      <section className={panel} aria-labelledby="sm-health">
        <h2 id="sm-health" className={heading}>
          System health
        </h2>
        <Health items={data.health} />
      </section>
    </>
  );
}

function Kpi({ k, canOpenAnalytics }: { k: KpiTile | HiddenKpi; canOpenAnalytics: boolean }) {
  return (
    <div className={`${panel} flex flex-col`} title={k.description}>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{k.label}</div>
      {isHidden(k) ? (
        <p className="mt-1 text-xs text-zinc-400">Not available to you.</p>
      ) : (
        <>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{formatValue(k.value, k.unit)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>was {formatValue(k.previous, k.unit)}</span>
            <ChangeChip change={k.change} higherIsBetter={k.higherIsBetter} />
          </div>
        </>
      )}
      <div className="mt-auto flex gap-3 pt-2 text-xs">
        {canOpenAnalytics && !isHidden(k) && (
          <Link href={builderHref(k.query)} className="text-indigo-600 hover:underline dark:text-indigo-400">
            Report
          </Link>
        )}
        <Link href={k.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
          Open list
        </Link>
      </div>
    </div>
  );
}

function TileBody({ tile, render }: { tile: Tile; render: (r: ReportResult) => React.ReactNode }) {
  if (tile.status !== "OK") return <p className="text-xs text-zinc-500">{tile.status === "HIDDEN" ? `Not available to you. ${tile.message}` : tile.message}</p>;
  return (
    <div className="space-y-2">
      {render(tile.result)}
      {tile.result.meta.freshness.some((f) => f.status !== "CURRENT") && <FreshnessBadges result={tile.result} />}
    </div>
  );
}

function Ranking({ title, tile }: { title: string; tile: Tile }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <TileBody tile={tile} render={(r) => (r.rows.length ? <AnalyticsChart result={r} kind="bar" /> : <p className="text-xs text-zinc-500">No bookings in the period.</p>)} />
    </div>
  );
}

function Targets({ result }: { result: ReportResult }) {
  if (!result.rows.length) return <p className="mt-1 text-xs text-zinc-500">No approved targets overlap this period.</p>;
  return (
    <ul className="mt-1 space-y-1.5">
      {result.rows.map((r, i) => {
        const pct = r.values.target_attainment;
        return (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_8rem_4rem] items-center gap-2 text-xs">
            <span className="truncate" title={r.labels.target}>
              {r.labels.target}
            </span>
            <div className="h-2 rounded bg-zinc-100 dark:bg-zinc-800">
              <div className={`h-2 rounded ${pct === null ? "" : pct >= 100 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
            </div>
            <span className="text-right tabular-nums">{formatValue(pct, "percent")}</span>
          </li>
        );
      })}
    </ul>
  );
}

const TONE: Record<QueueItem["tone"], string> = {
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
};

function WorkQueue({ items }: { items: QueueItem[] }) {
  const open = items.filter((i) => i.count > 0);
  if (!items.length) return <p className="mt-2 text-sm text-zinc-500">Nothing here for your access.</p>;
  return (
    <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
      {open.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className="flex items-center justify-between gap-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/40" title={i.hint}>
            <span className="text-sm text-zinc-800 dark:text-zinc-100">{i.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${TONE[i.tone]}`}>{i.count.toLocaleString("en-IN")}</span>
          </Link>
        </li>
      ))}
      {!open.length && <li className="py-2 text-sm text-emerald-700 dark:text-emerald-400">All clear — nothing waiting on you.</li>}
      {open.length > 0 && open.length < items.length && <li className="pt-2 text-xs text-zinc-500">{items.length - open.length} other check(s) are clear.</li>}
    </ul>
  );
}

const DOT: Record<HealthItem["status"], string> = { OK: "bg-emerald-500", WARN: "bg-amber-500", FAIL: "bg-red-500", UNKNOWN: "bg-zinc-400" };

function Health({ items }: { items: HealthItem[] }) {
  return (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((h) => (
        <li key={h.key}>
          <Link href={h.href} className="flex items-start gap-2 rounded-md border border-zinc-200 p-2.5 hover:border-indigo-300 dark:border-zinc-800">
            <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT[h.status]}`} aria-label={h.status} />
            <span>
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">{h.label}</span>
              <span className="block text-xs text-zinc-500">{h.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

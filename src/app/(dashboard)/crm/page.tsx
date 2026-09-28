"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { humanizeStatus } from "@/lib/humanize-status";
import { toIsoDate } from "@/lib/date";
import { STAGE_KIND_BADGE_CLASS, type StageKind } from "../leads/statusLabels";

interface FollowupItem {
  id: string;
  followupDate: string;
  type: string;
  notes: string | null;
  relatedModule: string;
  relatedRecordId: string;
  relatedLabel: string;
  assignedTo: string | null;
}

interface CrmDashboardData {
  kpis: {
    totalLeads: number;
    newLeads: number;
    contactedLeads: number;
    neverContactedLeads: number;
    qualifiedLeads: number;
    hotLeads: number;
    samplingRequested: number;
    wonLeads: number;
    lostLeads: number;
    openOpportunities: number;
    wonDeals: number;
    lostDeals: number;
    followupsDueToday: number;
    overdueFollowups: number;
    expectedBusinessValue: number;
    weightedPipelineValue: number;
    openLeadValue: number;
    convertedCustomers: number;
    leadConversionRate: number | null;
  };
  funnel: Array<{ label: string; segment: string | null; count: number }>;
  pipelineByStage: Array<{ stageId: string; name: string; kind: StageKind; count: number; value: number }>;
  dealsByStage: Record<string, number>;
  sourcePerformance: Array<{
    sourceId: string | null;
    name: string;
    leads: number;
    qualified: number;
    won: number;
    lost: number;
    wonValue: number;
    winRate: number | null;
  }>;
  salespersonPerformance: Array<{
    userId: string;
    fullName: string;
    leads: number;
    contacted: number;
    neverContacted: number;
    wonLeads: number;
    overdueFollowups: number;
    openPipeline: number;
    wonValue: number;
  }>;
  unassignedOverdue: number;
  overdueFollowups: FollowupItem[];
  upcomingFollowups: FollowupItem[];
  recentActivities: Array<{
    id: string;
    activityType: string;
    subject: string | null;
    activityAt: string;
    relatedModule: string;
    relatedRecordId: string;
    relatedLabel: string;
    performedBy: string;
  }>;
  closingSoon: Array<{
    id: string;
    title: string;
    value: number;
    probabilityPercent: number;
    expectedCloseDate: string;
    overdue: boolean;
    party: string | null;
  }>;
  monthlyTrend: Array<{ month: string; created: number; won: number }>;
}

type Preset = "today" | "week" | "month" | "quarter" | "year";

function datePreset(preset: Preset): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const to = toIsoDate(now);
  if (preset === "today") return { dateFrom: to, dateTo: to };
  if (preset === "week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    return { dateFrom: toIsoDate(monday), dateTo: to };
  }
  if (preset === "month") return { dateFrom: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: to };
  if (preset === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { dateFrom: toIsoDate(new Date(now.getFullYear(), quarterStartMonth, 1)), dateTo: to };
  }
  return { dateFrom: toIsoDate(new Date(now.getFullYear(), 0, 1)), dateTo: to };
}

const CHART_PRIMARY = "#6366f1";
const CHART_SECONDARY = "#059669";
const money = (v: number) => `₹${Math.round(v).toLocaleString()}`;

function relatedHref(module: string, id: string) {
  if (module === "LEAD") return `/leads/${id}`;
  if (module === "DEAL") return `/deals/${id}`;
  return `/masters/customers/${id}/360`;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function KpiCard({ label, value, href, hint, tone = "default" }: { label: string; value: string; href?: string; hint?: string; tone?: "default" | "alert" }) {
  const body = (
    <>
      <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === "alert" ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </>
  );
  const cls = "block rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5`}>
      {body}
    </Link>
  ) : (
    <div className={`${cls} opacity-70`}>{body}</div>
  );
}

/** A single-series horizontal bar list — label, proportional bar, value. */
function BarList({ rows, format = (v: number) => v.toLocaleString() }: { rows: Array<{ key: string; label: ReactNode; value: number; href?: string; sub?: string }>; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => {
        const inner = (
          <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2" title={`${typeof r.label === "string" ? r.label : ""}: ${format(r.value)}`}>
            <span className="truncate">{r.label}</span>
            <span className="h-3 rounded-r bg-zinc-100 dark:bg-zinc-800">
              <span className="block h-3 rounded-r" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: CHART_PRIMARY, minWidth: r.value > 0 ? 3 : 0 }} />
            </span>
            <span className="text-right font-medium tabular-nums">
              {format(r.value)}
              {r.sub && <span className="ml-1 text-xs font-normal text-zinc-500">{r.sub}</span>}
            </span>
          </div>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block rounded px-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                {inner}
              </Link>
            ) : (
              <div className="px-1">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MonthlyTrend({ data }: { data: CrmDashboardData["monthlyTrend"] }) {
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(1, ...data.flatMap((d) => [d.created, d.won]));
  const label = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleString(undefined, { month: "short" });
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_PRIMARY }} /> Leads created
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_SECONDARY }} /> Leads won
        </span>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="ml-auto font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {showTable ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase text-zinc-500">
              <th className="py-1">Month</th>
              <th className="py-1 text-right">Created</th>
              <th className="py-1 text-right">Won</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1">{d.month}</td>
                <td className="py-1 text-right tabular-nums">{d.created}</td>
                <td className="py-1 text-right tabular-nums">{d.won}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex h-36 items-end gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {data.map((d) => (
            <div key={d.month} className="flex h-full flex-1 flex-col justify-end" title={`${d.month}: ${d.created} created, ${d.won} won`}>
              <div className="flex h-full items-end justify-center gap-[2px]">
                <div className="w-1/2 max-w-3 rounded-t" style={{ height: `${(d.created / max) * 100}%`, backgroundColor: CHART_PRIMARY, minHeight: d.created ? 2 : 0 }} />
                <div className="w-1/2 max-w-3 rounded-t" style={{ height: `${(d.won / max) * 100}%`, backgroundColor: CHART_SECONDARY, minHeight: d.won ? 2 : 0 }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!showTable && (
        <div className="mt-1 flex gap-1 text-[10px] text-zinc-500">
          {data.map((d) => (
            <span key={d.month} className="flex-1 text-center">
              {label(d.month)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupList({ items, empty }: { items: FollowupItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {items.map((f) => (
        <li key={f.id} className="py-1.5">
          <div className="flex justify-between gap-2">
            <Link href={relatedHref(f.relatedModule, f.relatedRecordId)} className="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              {f.relatedLabel}
            </Link>
            <span className="shrink-0 text-xs text-zinc-500">{new Date(f.followupDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div className="text-xs text-zinc-500">
            {humanizeStatus(f.type)} · {f.assignedTo ?? "Unassigned"}
            {f.notes ? ` · ${f.notes}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CrmDashboardPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<CrmDashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [hotThreshold, setHotThreshold] = useState("80");
  const [warmThreshold, setWarmThreshold] = useState("50");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const openSettingsModal = () => {
    setSettingsError(null);
    fetch("/api/v1/crm/settings")
      .then((res) => res.json())
      .then((body) => {
        setHotThreshold(String(body.data.hotThreshold));
        setWarmThreshold(String(body.data.warmThreshold));
      });
    setShowSettingsModal(true);
  };

  const saveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsError(null);
    const res = await fetch("/api/v1/crm/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotThreshold: Number(hotThreshold), warmThreshold: Number(warmThreshold) }),
    });
    setIsSavingSettings(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setSettingsError(body?.error?.message ?? "Failed to save settings.");
      return;
    }
    setShowSettingsModal(false);
  };

  useEffect(() => {
    const url = new URL("/api/v1/crm/dashboard", window.location.origin);
    if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
    if (dateTo) url.searchParams.set("dateTo", dateTo);
    fetch(url.toString())
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load the CRM dashboard.");
        setData(body.data);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [dateFrom, dateTo]);

  const applyPreset = (preset: Preset) => {
    const range = datePreset(preset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  };

  /** Every lead-count card links to the Leads list with the same segment +
   * period, which uses the identical server-side definition. */
  const leadsHref = (params: Record<string, string | null | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (dateFrom) sp.set("createdFrom", dateFrom);
    if (dateTo) sp.set("createdTo", dateTo);
    const qs = sp.toString();
    return `/leads${qs ? `?${qs}` : ""}`;
  };

  const k = data?.kpis;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "CRM" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">CRM Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Who the buyers are, what&apos;s pending, who is responsible — and which enquiries are turning into business. Every number opens the
            records behind it.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/leads/new" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
            + New Lead
          </Link>
          <Link href="/follow-ups" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Follow-ups →
          </Link>
          <Link href="/deals/board" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Pipeline Board →
          </Link>
          <button type="button" onClick={openSettingsModal} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Lead Quality Thresholds
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["today", "week", "month", "quarter", "year"] as Preset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {preset === "today" ? "Today" : preset === "week" ? "This Week" : preset === "month" ? "This Month" : preset === "quarter" ? "This Quarter" : "This Year"}
          </button>
        ))}
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
        <span className="text-xs text-zinc-400">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
        {(dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            All time
          </button>
        )}
        <span className="text-xs text-zinc-500">Period applies to leads/opportunities created; follow-ups and activity are always live.</span>
      </div>

      {loadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{loadError}</p>
      ) : !data || !k ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          {(k.overdueFollowups > 0 || k.neverContactedLeads > 0) && (
            <div className="flex flex-wrap gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              <span className="font-semibold">Needs attention:</span>
              {k.overdueFollowups > 0 && (
                <Link href="/follow-ups" className="underline">
                  {k.overdueFollowups} overdue follow-up{k.overdueFollowups === 1 ? "" : "s"}
                </Link>
              )}
              {k.neverContactedLeads > 0 && (
                <Link href={leadsHref({ segment: "NEVER_CONTACTED" })} className="underline">
                  {k.neverContactedLeads} open lead{k.neverContactedLeads === 1 ? "" : "s"} never contacted
                </Link>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Total Leads" value={k.totalLeads.toLocaleString()} href={leadsHref({})} />
            <KpiCard label="New Leads" value={k.newLeads.toLocaleString()} href={leadsHref({ segment: "NEW" })} hint="Still in the first stage" />
            <KpiCard label="Leads Contacted" value={k.contactedLeads.toLocaleString()} href={leadsHref({ segment: "CONTACTED" })} />
            <KpiCard label="Qualified Leads" value={k.qualifiedLeads.toLocaleString()} href={leadsHref({ segment: "QUALIFIED" })} />
            <KpiCard label="Hot Leads" value={k.hotLeads.toLocaleString()} href={leadsHref({ segment: "HOT" })} />
            <KpiCard label="Follow-ups Due Today" value={k.followupsDueToday.toLocaleString()} href="/follow-ups" />
            <KpiCard label="Overdue Follow-ups" value={k.overdueFollowups.toLocaleString()} href="/follow-ups" tone={k.overdueFollowups > 0 ? "alert" : "default"} />
            <KpiCard label="Sampling Requested" value={k.samplingRequested.toLocaleString()} href={leadsHref({ segment: "SAMPLING" })} />
            <KpiCard label="Quotations Pending" value="—" hint="Available once CRM Quotations are built" />
            <KpiCard label="Open Opportunities" value={k.openOpportunities.toLocaleString()} href="/deals/board" />
            <KpiCard label="Leads Won" value={k.wonLeads.toLocaleString()} href={leadsHref({ segment: "WON" })} hint={k.leadConversionRate !== null ? `${k.leadConversionRate}% of decided` : undefined} />
            <KpiCard label="Leads Lost" value={k.lostLeads.toLocaleString()} href={leadsHref({ segment: "LOST" })} />
            <KpiCard label="Deals Won / Lost" value={`${k.wonDeals} / ${k.lostDeals}`} href="/deals?stage=WON" />
            <KpiCard
              label="Expected Business"
              value={money(k.expectedBusinessValue)}
              href="/deals/board"
              hint={`${money(k.weightedPipelineValue)} weighted deals + ${money(k.openLeadValue)} open leads`}
            />
            <KpiCard label="Converted Customers" value={k.convertedCustomers.toLocaleString()} href="/deals?stage=WON" hint="Distinct customers on won deals" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Lead Funnel">
              <BarList
                rows={data.funnel.map((step, i) => {
                  const prev = i > 0 ? data.funnel[i - 1].count : null;
                  return {
                    key: step.label,
                    label: step.label,
                    value: step.count,
                    href: leadsHref(step.segment ? { segment: step.segment } : {}),
                    sub: prev ? `${Math.round((step.count / prev) * 100)}%` : undefined,
                  };
                })}
              />
              <p className="mt-2 text-[11px] text-zinc-500">Percentages are of the previous step.</p>
            </Section>

            <Section title="Lead Pipeline by Stage">
              <BarList
                rows={data.pipelineByStage.map((s) => ({
                  key: s.stageId,
                  label: (
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STAGE_KIND_BADGE_CLASS[s.kind]}`}>{s.name}</span>
                  ),
                  value: s.count,
                  href: leadsHref({ stageId: s.stageId }),
                  sub: s.value > 0 ? money(s.value) : undefined,
                }))}
              />
            </Section>

            <Section title="Monthly Lead Trend (last 12 months)">
              <MonthlyTrend data={data.monthlyTrend} />
            </Section>

            <Section title="Lead Source Performance">
              {data.sourcePerformance.length === 0 ? (
                <p className="text-sm text-zinc-500">No leads in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-zinc-500">
                        <th className="py-1">Source</th>
                        <th className="py-1 text-right">Leads</th>
                        <th className="py-1 text-right">Qualified</th>
                        <th className="py-1 text-right">Won</th>
                        <th className="py-1 text-right">Win rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sourcePerformance.map((s) => (
                        <tr key={s.sourceId ?? "none"} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1">
                            {s.sourceId ? (
                              <Link href={leadsHref({ sourceId: s.sourceId })} className="text-indigo-600 hover:underline dark:text-indigo-400">
                                {s.name}
                              </Link>
                            ) : (
                              s.name
                            )}
                          </td>
                          <td className="py-1 text-right tabular-nums">{s.leads}</td>
                          <td className="py-1 text-right tabular-nums">{s.qualified}</td>
                          <td className="py-1 text-right tabular-nums">{s.won}</td>
                          <td className="py-1 text-right tabular-nums">{s.winRate === null ? "—" : `${s.winRate}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="Salesperson Performance" action={data.unassignedOverdue > 0 ? <span className="text-xs text-red-600">{data.unassignedOverdue} overdue unassigned</span> : undefined}>
              {data.salespersonPerformance.length === 0 ? (
                <p className="text-sm text-zinc-500">No assigned leads or opportunities in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-zinc-500">
                        <th className="py-1">Salesperson</th>
                        <th className="py-1 text-right">Leads</th>
                        <th className="py-1 text-right">Not contacted</th>
                        <th className="py-1 text-right">Overdue FU</th>
                        <th className="py-1 text-right">Won</th>
                        <th className="py-1 text-right">Open pipeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.salespersonPerformance.map((u) => (
                        <tr key={u.userId} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1">
                            <Link href={leadsHref({ assignedToUserId: u.userId })} className="text-indigo-600 hover:underline dark:text-indigo-400">
                              {u.fullName}
                            </Link>
                          </td>
                          <td className="py-1 text-right tabular-nums">{u.leads}</td>
                          <td className={`py-1 text-right tabular-nums ${u.neverContacted > 0 ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{u.neverContacted}</td>
                          <td className={`py-1 text-right tabular-nums ${u.overdueFollowups > 0 ? "font-medium text-red-600 dark:text-red-400" : ""}`}>{u.overdueFollowups}</td>
                          <td className="py-1 text-right tabular-nums">{u.wonLeads}</td>
                          <td className="py-1 text-right tabular-nums">{money(u.openPipeline)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="Opportunities Expected to Close (30 days)">
              {data.closingSoon.length === 0 ? (
                <p className="text-sm text-zinc-500">No open opportunities closing in the next 30 days.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                  {data.closingSoon.map((d) => (
                    <li key={d.id} className="flex justify-between gap-2 py-1.5">
                      <Link href={`/deals/${d.id}`} className="truncate text-indigo-600 hover:underline dark:text-indigo-400">
                        {d.title}
                        {d.party ? ` · ${d.party}` : ""}
                      </Link>
                      <span className="shrink-0 text-xs">
                        <span className={d.overdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500"}>{d.expectedCloseDate}</span> ·{" "}
                        {money(d.value)} · {d.probabilityPercent}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Overdue Follow-ups" action={<Link href="/follow-ups" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">All →</Link>}>
              <FollowupList items={data.overdueFollowups} empty="Nothing overdue — every follow-up is on time." />
            </Section>

            <Section title="Upcoming Follow-ups (7 days)" action={<Link href="/follow-ups" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">All →</Link>}>
              <FollowupList items={data.upcomingFollowups} empty="No follow-ups scheduled for the next 7 days." />
            </Section>

            <Section title="Recent Activities">
              {data.recentActivities.length === 0 ? (
                <p className="text-sm text-zinc-500">No activity logged yet.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                  {data.recentActivities.map((a) => (
                    <li key={a.id} className="py-1.5">
                      <div className="flex justify-between gap-2">
                        <Link href={relatedHref(a.relatedModule, a.relatedRecordId)} className="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                          {a.relatedLabel}
                        </Link>
                        <span className="shrink-0 text-xs text-zinc-500">{new Date(a.activityAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {humanizeStatus(a.activityType)} · {a.performedBy}
                        {a.subject ? ` · ${a.subject}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Opportunities by Stage">
              {Object.keys(data.dealsByStage).length === 0 ? (
                <p className="text-sm text-zinc-500">No opportunities in this period.</p>
              ) : (
                <BarList
                  rows={Object.entries(data.dealsByStage).map(([stage, n]) => ({
                    key: stage,
                    label: humanizeStatus(stage),
                    value: n,
                    href: `/deals?stage=${stage}`,
                  }))}
                />
              )}
            </Section>
          </div>
        </>
      )}

      <Modal open={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Lead Quality Thresholds">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            A lead scoring at or above the Hot threshold is Hot; at or above Warm (but below Hot) is Warm; below Warm is Cold. The Warm threshold
            also defines a &quot;Qualified&quot; lead for Marketing&apos;s own metrics.
          </p>
          <FormField label="Hot Threshold" htmlFor="hotThreshold" required>
            <input id="hotThreshold" type="number" min={0} max={100} value={hotThreshold} onChange={(e) => setHotThreshold(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Warm Threshold" htmlFor="warmThreshold" required>
            <input id="warmThreshold" type="number" min={0} max={100} value={warmThreshold} onChange={(e) => setWarmThreshold(e.target.value)} className={textInputClass()} />
          </FormField>
          {settingsError && <p className="text-sm text-red-600 dark:text-red-400">{settingsError}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowSettingsModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveSettings}
              disabled={isSavingSettings}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSavingSettings ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

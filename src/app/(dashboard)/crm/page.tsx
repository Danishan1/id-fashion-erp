"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { humanizeStatus } from "@/lib/humanize-status";

interface CrmDashboardData {
  totalLeads: number;
  newLeads: number;
  qualifiedLeads: number;
  openDeals: number;
  wonDeals: number;
  lostDeals: number;
  pipelineValue: number;
  weightedPipelineValue: number;
  wonValue: number;
  conversionRate: number;
  averageDealValue: number;
  dealsByStage: Record<string, number>;
  leadsBySource: Record<string, number>;
  topCustomers: Array<{ id: string; name: string; value: number }>;
  topOpportunities: Array<{ id: string; title: string; value: number; customerName: string | null }>;
  salesLeaderboard: Array<{ userId: string; fullName: string; leadCount: number; pipeline: number; wonValue: number }>;
  todaysFollowups: number;
  overdueFollowups: number;
}

// Deliberately reads LOCAL calendar components (never .toISOString(), which
// converts through UTC) — "This Month"/"This Quarter"/"This Year" are
// business-calendar concepts in the browser's own timezone, not UTC
// timestamps. On IST (UTC+5:30), local midnight of the 1st is 18:30 UTC on
// the LAST day of the PREVIOUS month, so .toISOString().slice(0,10) reported
// the wrong day for every "start of period" preset (ERP-BUG-0001, Phase 10
// QA pass) — confirmed live: "This Month" on 2026-08-26 returned 2026-07-31.
function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  if (preset === "month") {
    return { dateFrom: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: to };
  }
  if (preset === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { dateFrom: toIsoDate(new Date(now.getFullYear(), quarterStartMonth, 1)), dateTo: to };
  }
  return { dateFrom: toIsoDate(new Date(now.getFullYear(), 0, 1)), dateTo: to };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {children}
    </div>
  );
}

export default function CrmDashboardPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<CrmDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
      .then((res) => res.json())
      .then((body) => setData(body.data))
      .finally(() => setIsLoading(false));
  }, [dateFrom, dateTo]);

  const applyPreset = (preset: Preset) => {
    const range = datePreset(preset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  };

  const clearRange = () => {
    setDateFrom("");
    setDateTo("");
  };

  const cards: Array<[string, string]> = data
    ? [
        ["Total Leads", data.totalLeads.toLocaleString()],
        ["New Leads", data.newLeads.toLocaleString()],
        ["Qualified Leads", data.qualifiedLeads.toLocaleString()],
        ["Open Deals", data.openDeals.toLocaleString()],
        ["Won Deals", data.wonDeals.toLocaleString()],
        ["Lost Deals", data.lostDeals.toLocaleString()],
        ["Pipeline Value", `₹${data.pipelineValue.toLocaleString()}`],
        ["Weighted Pipeline", `₹${Math.round(data.weightedPipelineValue).toLocaleString()}`],
        ["Won Value", `₹${data.wonValue.toLocaleString()}`],
        ["Conversion Rate", `${data.conversionRate.toFixed(1)}%`],
        ["Avg. Deal Value", `₹${Math.round(data.averageDealValue).toLocaleString()}`],
        ["Today's Follow-ups", data.todaysFollowups.toLocaleString()],
        ["Overdue Follow-ups", data.overdueFollowups.toLocaleString()],
      ]
    : [];

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "CRM" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">CRM Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Leads, pipeline, and salesperson performance, computed live.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/leads" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            All Leads →
          </Link>
          <Link href="/deals/board" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Pipeline Board →
          </Link>
          <button type="button" onClick={openSettingsModal} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Priority Settings
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
          <button type="button" onClick={clearRange} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            All time
          </button>
        )}
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
                <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Deals by Stage">
              {Object.keys(data.dealsByStage).length === 0 ? (
                <p className="text-sm text-zinc-500">No deals in this period.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {Object.entries(data.dealsByStage).map(([stage, count]) => (
                    <li key={stage} className="flex justify-between">
                      <span>{humanizeStatus(stage)}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Leads by Source">
              {Object.keys(data.leadsBySource).length === 0 ? (
                <p className="text-sm text-zinc-500">No leads in this period.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {Object.entries(data.leadsBySource).map(([source, count]) => (
                    <li key={source} className="flex justify-between">
                      <span>{humanizeStatus(source)}</span>
                      <span className="font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Top Customers (by Won Value)">
              {data.topCustomers.length === 0 ? (
                <p className="text-sm text-zinc-500">No won deals with a linked customer in this period.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.topCustomers.map((c) => (
                    <li key={c.id} className="flex justify-between">
                      <a href={`/masters/customers/${c.id}/360`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {c.name}
                      </a>
                      <span className="font-medium">₹{c.value.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Top Opportunities (Open Deals)">
              {data.topOpportunities.length === 0 ? (
                <p className="text-sm text-zinc-500">No open deals in this period.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.topOpportunities.map((d) => (
                    <li key={d.id} className="flex justify-between">
                      <a href={`/deals/${d.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {d.title} {d.customerName ? `(${d.customerName})` : ""}
                      </a>
                      <span className="font-medium">₹{d.value.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Salesperson Performance (all-time)">
              {data.salesLeaderboard.length === 0 ? (
                <p className="text-sm text-zinc-500">No active salespeople.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-zinc-500">
                      <th className="py-1">Name</th>
                      <th className="py-1 text-right">Leads</th>
                      <th className="py-1 text-right">Pipeline</th>
                      <th className="py-1 text-right">Won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.salesLeaderboard.map((u) => (
                      <tr key={u.userId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1">{u.fullName}</td>
                        <td className="py-1 text-right">{u.leadCount}</td>
                        <td className="py-1 text-right">₹{u.pipeline.toLocaleString()}</td>
                        <td className="py-1 text-right">₹{u.wonValue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          </div>
        </>
      )}

      <Modal open={showSettingsModal} onClose={() => setShowSettingsModal(false)} title="Lead Priority Settings">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            A lead scoring at or above the Hot threshold shows as Hot; at or above Warm (but below Hot) shows as Warm; below Warm shows as Normal. The
            Warm threshold also defines a &quot;Qualified&quot; lead for Marketing&apos;s own metrics.
          </p>
          <FormField label="Hot Threshold" htmlFor="hotThreshold" required>
            <input
              id="hotThreshold"
              type="number"
              min={0}
              max={100}
              value={hotThreshold}
              onChange={(e) => setHotThreshold(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Warm Threshold" htmlFor="warmThreshold" required>
            <input
              id="warmThreshold"
              type="number"
              min={0}
              max={100}
              value={warmThreshold}
              onChange={(e) => setWarmThreshold(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          {settingsError && <p className="text-sm text-red-600 dark:text-red-400">{settingsError}</p>}
          <button
            type="button"
            onClick={saveSettings}
            disabled={isSavingSettings}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSavingSettings ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

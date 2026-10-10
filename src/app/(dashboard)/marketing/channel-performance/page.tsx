"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { toIsoDate } from "@/lib/date";
import { CHANNEL_LABELS } from "../../campaigns/statusLabels";

interface ChannelRow {
  channel: keyof typeof CHANNEL_LABELS;
  campaignCount: number;
  leads: number;
  deals: number;
  wonDeals: number;
  revenue: number;
  spend: number;
  roi: number;
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

function downloadCsv(rows: ChannelRow[]) {
  const header = ["Channel", "Campaigns", "Leads", "Deals", "Won Deals", "Revenue", "Spend", "ROI %"];
  const lines = rows.map((r) =>
    [
      CHANNEL_LABELS[r.channel] ?? r.channel,
      r.campaignCount,
      r.leads,
      r.deals,
      r.wonDeals,
      r.revenue.toFixed(2),
      r.spend.toFixed(2),
      (r.roi * 100).toFixed(1),
    ].join(",")
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `channel-performance-${toIsoDate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChannelPerformancePage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [channel, setChannel] = useState("");
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const url = new URL("/api/v1/marketing/channel-performance", window.location.origin);
    if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
    if (dateTo) url.searchParams.set("dateTo", dateTo);
    if (channel) url.searchParams.set("channel", channel);
    fetch(url.toString())
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body) => {
        setRows(body.data);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, [dateFrom, dateTo, channel]);

  const applyPreset = (preset: Preset) => {
    const range = datePreset(preset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  };

  const totals = rows?.reduce(
    (acc, r) => ({
      campaignCount: acc.campaignCount + r.campaignCount,
      leads: acc.leads + r.leads,
      deals: acc.deals + r.deals,
      wonDeals: acc.wonDeals + r.wonDeals,
      revenue: acc.revenue + r.revenue,
      spend: acc.spend + r.spend,
    }),
    { campaignCount: 0, leads: 0, deals: 0, wonDeals: 0, revenue: 0, spend: 0 }
  );

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Marketing", href: "/marketing" }, { label: "Channel Performance" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Channel Performance</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Leads → Deals → Won Deals → Revenue → ROI, aggregated by marketing channel using existing attribution data.
        </p>
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
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">All Channels</option>
          {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {(dateFrom || dateTo || channel) && (
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setChannel("");
            }}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          onClick={() => rows && downloadCsv(rows)}
          disabled={!rows || rows.length === 0}
          className="ml-auto rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export CSV
        </button>
      </div>

      {loadFailed ? (
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load channel performance — you may not have permission, or the request failed.</p>
      ) : !rows ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No campaign activity in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Channel</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Campaigns</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Leads</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Deals</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Won</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Revenue</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Spend</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.channel}>
                  <td className="px-4 py-2">
                    <a href={`/campaigns?channel=${r.channel}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {CHANNEL_LABELS[r.channel] ?? r.channel}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{r.campaignCount}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{r.leads}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{r.deals}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{r.wonDeals}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">₹{r.revenue.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">₹{r.spend.toLocaleString()}</td>
                  <td className={`px-4 py-2 text-right font-medium ${r.roi >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {(r.roi * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot className="border-t-2 border-zinc-200 bg-zinc-50 font-medium dark:border-zinc-700 dark:bg-zinc-900">
                <tr>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">Total</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">{totals.campaignCount}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">{totals.leads}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">{totals.deals}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">{totals.wonDeals}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">₹{totals.revenue.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">₹{totals.spend.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-50">
                    {totals.spend > 0 ? (((totals.revenue - totals.spend) / totals.spend) * 100).toFixed(1) : "0.0"}%
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

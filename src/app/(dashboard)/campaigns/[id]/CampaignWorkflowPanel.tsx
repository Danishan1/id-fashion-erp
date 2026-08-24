"use client";

import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { CHANNEL_LABELS, STATUS_LABELS, ALERT_TYPE_LABELS } from "../statusLabels";

interface DailyMetric {
  id: string;
  metricDate: string;
  spend: string;
  impressions: string;
  clicks: string;
}

interface Attribution {
  id: string;
  source: string | null;
  medium: string | null;
  utmCampaign: string | null;
  attributedRevenue: string;
  createdAt: string;
  lead: { id: string; leadNumber: string; name: string } | null;
}

interface Alert {
  id: string;
  alertType: keyof typeof ALERT_TYPE_LABELS;
  priority: "MEDIUM" | "HIGH";
  title: string;
  message: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

interface CampaignDetail {
  id: string;
  campaignNumber: string;
  name: string;
  objective: string | null;
  channel: keyof typeof CHANNEL_LABELS;
  status: keyof typeof STATUS_LABELS;
  budget: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  owner: { fullName: string } | null;
  metrics: { spend: number; leads: number; qualifiedLeads: number; customers: number; revenue: number };
  dailyMetrics: DailyMetric[];
  attributions: Attribution[];
  alerts: Alert[];
}

export function CampaignWorkflowPanel({ campaign }: { campaign: CampaignDetail }) {
  const [dailyMetrics, setDailyMetrics] = useState(campaign.dailyMetrics);
  const [alerts, setAlerts] = useState(campaign.alerts);
  const [showMetricModal, setShowMetricModal] = useState(false);
  const [metricDate, setMetricDate] = useState("");
  const [metricSpend, setMetricSpend] = useState("0");
  const [metricImpressions, setMetricImpressions] = useState("0");
  const [metricClicks, setMetricClicks] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);

  const roas = campaign.metrics.spend ? campaign.metrics.revenue / campaign.metrics.spend : 0;
  const cpl = campaign.metrics.leads ? campaign.metrics.spend / campaign.metrics.leads : 0;

  const submitMetric = async () => {
    setError(null);
    const res = await fetch(`/api/v1/campaigns/${campaign.id}/daily-metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricDate, spend: Number(metricSpend), impressions: Number(metricImpressions), clicks: Number(metricClicks) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to record this metric.");
      return;
    }
    const { data } = await res.json();
    setDailyMetrics((prev) => [data, ...prev.filter((m) => m.metricDate !== data.metricDate)]);
    setShowMetricModal(false);
    window.location.reload();
  };

  const runAutomation = async () => {
    setIsBusy(true);
    setAutomationMessage(null);
    const res = await fetch("/api/v1/campaigns/run-automation", { method: "POST" });
    setIsBusy(false);
    if (res.ok) {
      setAutomationMessage("Automation cycle executed — reload to see any new alerts.");
      window.location.reload();
    }
  };

  const resolveAlert = async (id: string) => {
    const res = await fetch(`/api/v1/campaign-alerts/${id}/resolve`, { method: "POST" });
    if (res.ok) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: "RESOLVED" } : a)));
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {STATUS_LABELS[campaign.status]}
        </span>
        <Link href={`/campaigns/${campaign.id}/edit`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Edit
        </Link>
        <button
          type="button"
          disabled={isBusy}
          onClick={runAutomation}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Run Automation Now
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {automationMessage && <p className="text-sm text-zinc-500">{automationMessage}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Budget", `₹${Number(campaign.budget).toLocaleString()}`],
          ["Spend", `₹${campaign.metrics.spend.toLocaleString()}`],
          ["Leads", campaign.metrics.leads],
          ["Qualified", campaign.metrics.qualifiedLeads],
          ["Customers", campaign.metrics.customers],
          ["Revenue", `₹${campaign.metrics.revenue.toLocaleString()}`],
          ["ROAS", `${roas.toFixed(2)}x`],
          ["CPL", `₹${cpl.toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Channel</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{CHANNEL_LABELS[campaign.channel]}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Objective</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{campaign.objective ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Owner</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{campaign.owner?.fullName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Dates</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
            {campaign.startDate ? new Date(campaign.startDate).toLocaleDateString() : "—"} –{" "}
            {campaign.endDate ? new Date(campaign.endDate).toLocaleDateString() : "—"}
          </dd>
        </div>
        {campaign.notes && (
          <div className="col-span-full">
            <dt className="text-xs font-medium uppercase text-zinc-500">Notes</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{campaign.notes}</dd>
          </div>
        )}
      </dl>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Alerts</h2>
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-zinc-500">No alerts.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className={`flex items-center justify-between rounded-lg border p-3 text-sm ${
                  a.status === "OPEN"
                    ? a.priority === "HIGH"
                      ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                      : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">{ALERT_TYPE_LABELS[a.alertType] ?? a.alertType}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">{a.message}</p>
                </div>
                {a.status === "OPEN" && (
                  <button type="button" onClick={() => resolveAlert(a.id)} className="text-xs font-medium text-indigo-600 hover:underline">
                    Resolve
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Daily Metrics</h2>
          <button type="button" onClick={() => setShowMetricModal(true)} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Record Daily Metrics
          </button>
        </div>
        {dailyMetrics.length === 0 ? (
          <p className="text-sm text-zinc-500">No daily metrics recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Date</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Spend</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Impressions</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {dailyMetrics.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-zinc-900 dark:text-zinc-50">{new Date(m.metricDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">₹{Number(m.spend).toLocaleString()}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{Number(m.impressions).toLocaleString()}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{Number(m.clicks).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attribution</h2>
        {campaign.attributions.length === 0 ? (
          <p className="text-sm text-zinc-500">No attribution touches recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {campaign.attributions.map((a) => (
              <li key={a.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>
                    {a.source ?? "—"} / {a.medium ?? "—"}
                  </span>
                  <span>{new Date(a.createdAt).toLocaleString()}</span>
                </div>
                {a.lead && (
                  <a href={`/leads/${a.lead.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {a.lead.name} ({a.lead.leadNumber})
                  </a>
                )}
                {Number(a.attributedRevenue) > 0 && <p className="text-xs text-zinc-500">Attributed revenue: ₹{Number(a.attributedRevenue).toLocaleString()}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={showMetricModal} onClose={() => setShowMetricModal(false)} title="Record Daily Metrics">
        <div className="space-y-3">
          <FormField label="Date" htmlFor="metricDate" required>
            <input id="metricDate" type="date" required value={metricDate} onChange={(e) => setMetricDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Spend" htmlFor="metricSpend">
            <input id="metricSpend" type="number" min={0} step="0.01" value={metricSpend} onChange={(e) => setMetricSpend(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Impressions" htmlFor="metricImpressions">
            <input id="metricImpressions" type="number" min={0} value={metricImpressions} onChange={(e) => setMetricImpressions(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Clicks" htmlFor="metricClicks">
            <input id="metricClicks" type="number" min={0} value={metricClicks} onChange={(e) => setMetricClicks(e.target.value)} className={textInputClass()} />
          </FormField>
          <button
            type="button"
            onClick={submitMetric}
            disabled={!metricDate}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </Modal>
    </div>
  );
}

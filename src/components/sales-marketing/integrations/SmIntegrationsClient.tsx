"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { ApiGuidePanel } from "./ApiGuidePanel";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { ConflictsPanel } from "./ConflictsPanel";
import { Badge, CARD, INT_API, INT_PAGE, StatusBadge, useApi, type IntegrationRow, type MetricsDto } from "./integration-ui";
import { WebhooksPanel } from "./WebhooksPanel";

export type IntegrationsTab = "registry" | "keys" | "webhooks" | "conflicts" | "guide";
const TABS: [IntegrationsTab, string][] = [
  ["registry", "Integrations"],
  ["keys", "API keys"],
  ["webhooks", "Outgoing webhooks"],
  ["conflicts", "Sync conflicts"],
  ["guide", "API & webhook guide"],
];

/** Phase 16 — Sales & Marketing → Integrations. */
export function SmIntegrationsClient({ initialTab = "registry", canEdit, canApprove, origin }: { initialTab?: IntegrationsTab; canEdit: boolean; canApprove: boolean; origin: string }) {
  const [tab, setTab] = useState<IntegrationsTab>(initialTab);
  const metrics = useApi<MetricsDto>(`${INT_API}/metrics`);
  return (
    <div className="space-y-4">
      <MetricTiles m={metrics.data} onConflicts={() => setTab("conflicts")} />
      <div className="flex flex-wrap gap-1 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Integrations view">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 text-sm font-medium ${tab === k ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "registry" && <RegistryList />}
      {tab === "keys" && <ApiKeysPanel canEdit={canEdit} canApprove={canApprove} />}
      {tab === "webhooks" && <WebhooksPanel canEdit={canEdit} canApprove={canApprove} />}
      {tab === "conflicts" && <ConflictsPanel canApprove={canApprove} />}
      {tab === "guide" && <ApiGuidePanel origin={origin} />}
    </div>
  );
}

function Tile({ label, value, hint, alert }: { label: string; value: string | number; hint?: string; alert?: boolean }) {
  return (
    <div className={CARD}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${alert ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function MetricTiles({ m, onConflicts }: { m: MetricsDto | null; onConflicts: () => void }) {
  if (!m) return null;
  const attention = (m.registry.FAILED ?? 0) + (m.registry.DEGRADED ?? 0);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Integrations needing attention" value={attention} alert={attention > 0} hint={`${m.registry.CONNECTED ?? 0} connected`} />
      <Tile label="API calls (24 h)" value={m.api.requests} hint={m.api.errorRatePercent === null ? "No calls" : `${m.api.errorRatePercent}% failed · ${m.api.rateLimited} rate-limited`} alert={(m.api.errorRatePercent ?? 0) >= 20} />
      <Tile label="Webhooks delivered (24 h)" value={m.webhooks.delivered} hint={`${m.webhooks.failed} failed · ${m.webhooks.pending} queued`} alert={m.webhooks.failed > 0} />
      <Tile label="Delivery queue" value={m.webhooks.queueLatencySeconds ? `${Math.round(m.webhooks.queueLatencySeconds / 60)} min behind` : "On time"} hint={`${m.webhooks.retried} retried (24 h)`} alert={m.webhooks.queueLatencySeconds > 600} />
      <Tile label="Provider callbacks (24 h)" value={m.inbound.accepted} hint={`${m.inbound.rejected} failed verification`} alert={m.inbound.rejected > 0} />
      <button type="button" onClick={onConflicts} className="text-left">
        <Tile label="Open sync conflicts" value={m.sync.openConflicts} alert={m.sync.openConflicts > 0} hint={m.sync.lastRunAt ? "Click to review" : "No sync yet"} />
      </button>
    </div>
  );
}

function RegistryList() {
  const { data, error, reload } = useApi<IntegrationRow[]>(INT_API);
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  if (!data.length) return <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No integrations yet. Create an API key or an outgoing webhook, or set up a marketing delivery connection.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Every external connection in one place, with its status from what actually happened (calls, deliveries, checks and callbacks). Credentials stay with each integration and are never shown here. CRM integrations are listed for completeness and managed in CRM Settings.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Integration</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Can do</th>
              <th className="px-3 py-2 font-medium">Last success</th>
              <th className="px-3 py-2 font-medium">Last error</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  <Link href={`${INT_PAGE}/${r.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {r.name}
                  </Link>
                  <div className="text-xs text-zinc-500">
                    {r.kindLabel} · {r.providerLabel}
                    {r.managedIn === "CRM" && " · managed in CRM"}
                  </div>
                  {r.liveVerified === false && <div className="mt-0.5"><Badge tone="amber">Not live-verified</Badge></div>}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge label={r.statusLabel} tone={r.statusTone} />
                  {r.statusReason && <div className="mt-1 max-w-xs text-xs text-zinc-500">{r.statusReason}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{r.capabilities.map((c) => c.label).join(", ") || "—"}</td>
                <td className="px-3 py-2 text-xs">{r.lastSuccessAt ? <ClientDateTime value={r.lastSuccessAt} /> : "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {r.lastErrorAt ? <ClientDateTime value={r.lastErrorAt} /> : "—"}
                  {r.lastError && <div className="max-w-xs text-red-600 dark:text-red-400">{r.lastError}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

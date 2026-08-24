"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

type Platform = "META" | "GOOGLE";

interface CampaignLink {
  id: string;
  externalCampaignId: string;
  externalCampaignName: string;
  localCampaign: { id: string; name: string } | null;
}

interface Connection {
  id: string;
  platform: Platform;
  externalAccountId: string;
  accountName: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  connectedBy: { fullName: string } | null;
  campaignLinks: CampaignLink[];
}

interface LocalCampaignOption {
  id: string;
  name: string;
}

const PLATFORM_LABELS: Record<Platform, string> = { META: "Meta Ads", GOOGLE: "Google Ads" };

const STATUS_BADGE: Record<Connection["status"], string> = {
  CONNECTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  DISCONNECTED: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  ERROR: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

export default function AdIntegrationsPage() {
  return (
    <Suspense>
      <AdIntegrationsContent />
    </Suspense>
  );
}

function AdIntegrationsContent() {
  const searchParams = useSearchParams();
  const [configStatus, setConfigStatus] = useState<Record<Platform, boolean> | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [localCampaigns, setLocalCampaigns] = useState<LocalCampaignOption[] | null>(null);
  const [linksModalConnection, setLinksModalConnection] = useState<Connection | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = () => {
    fetch("/api/v1/ad-integrations/config-status")
      .then((res) => res.json())
      .then((body) => setConfigStatus(body.data));
    fetch("/api/v1/ad-integrations")
      .then((res) => res.json())
      .then((body) => setConnections(body.data));
    fetch("/api/v1/campaigns?pageSize=200")
      .then((res) => res.json())
      .then((body) => setLocalCampaigns(body.data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))));
  };

  useEffect(load, []);

  const connectedCount = searchParams.get("connected");
  const oauthError = searchParams.get("error");
  const oauthPlatform = searchParams.get("platform") as Platform | null;

  const syncNow = async (connection: Connection) => {
    setSyncingId(connection.id);
    setActionMessage(null);
    const res = await fetch(`/api/v1/ad-integrations/${connection.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    setSyncingId(null);
    if (res.ok) {
      setActionMessage(
        `${connection.accountName}: wrote ${body.data.metricsWritten} metric row(s)` +
          (body.data.skipped.length > 0 ? `, ${body.data.skipped.length} skipped (see linked campaign's own status).` : ".")
      );
    } else {
      setActionMessage(`${connection.accountName}: ${body?.error?.message ?? "Sync failed."}`);
    }
    load();
  };

  const confirmDisconnect = async () => {
    if (!disconnectTarget) return;
    await fetch(`/api/v1/ad-integrations/${disconnectTarget.id}/disconnect`, { method: "POST" });
    setDisconnectTarget(null);
    load();
  };

  const setLink = async (connectionId: string, linkId: string, localCampaignId: string | null) => {
    await fetch(`/api/v1/ad-integrations/${connectionId}/links/${linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localCampaignId }),
    });
    load();
    // Keep the modal's own copy in sync without a full reload of the modal.
    setLinksModalConnection((prev) =>
      prev
        ? {
            ...prev,
            campaignLinks: prev.campaignLinks.map((l) =>
              l.id === linkId ? { ...l, localCampaign: localCampaigns?.find((c) => c.id === localCampaignId) ?? null } : l
            ),
          }
        : prev
    );
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Marketing", href: "/marketing" }, { label: "Ad Integrations" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Ad Integrations</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Connect a real Meta Ads or Google Ads account to sync daily spend/impressions/clicks straight into the exact
          same Campaign Daily Metrics used everywhere else in this app — a synced number and a manually-entered one are
          indistinguishable to every dashboard, chart, and alert. Nothing syncs automatically; use &ldquo;Sync Now&rdquo;
          whenever you want fresh numbers.
        </p>
      </div>

      {connectedCount && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          Connected {connectedCount} {oauthPlatform ? PLATFORM_LABELS[oauthPlatform] : ""} account(s).
        </p>
      )}
      {oauthError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{oauthError}</p>
      )}
      {actionMessage && <p className="text-sm text-zinc-600 dark:text-zinc-300">{actionMessage}</p>}

      <div className="flex flex-wrap gap-3">
        {(["META", "GOOGLE"] as Platform[]).map((platform) => {
          const isConfigured = configStatus?.[platform];
          return (
            <div key={platform} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{PLATFORM_LABELS[platform]}</div>
              {configStatus === null ? (
                <p className="mt-1 text-xs text-zinc-500">Checking configuration…</p>
              ) : isConfigured ? (
                <a
                  href={`/api/v1/ad-integrations/connect/${platform.toLowerCase()}/authorize`}
                  className="mt-2 inline-block rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Connect {PLATFORM_LABELS[platform]}
                </a>
              ) : (
                <p className="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-400">
                  Not configured — set{" "}
                  {platform === "META" ? "META_APP_ID / META_APP_SECRET" : "GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN"}{" "}
                  in your environment (see .env.example) to enable connecting.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Connected Accounts</h2>
        {!connections ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-zinc-500">No ad accounts connected yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Platform</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Account</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Status</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Last Synced</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Campaigns Linked</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{PLATFORM_LABELS[c.platform]}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                      {c.accountName} <span className="text-xs text-zinc-400">({c.externalAccountId})</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}>{c.status}</span>
                      {c.lastSyncError && <div className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{c.lastSyncError}</div>}
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                      {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                      {c.campaignLinks.filter((l) => l.localCampaign).length} / {c.campaignLinks.length}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={c.status === "DISCONNECTED" || syncingId === c.id}
                          onClick={() => syncNow(c)}
                          className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400"
                        >
                          {syncingId === c.id ? "Syncing…" : "Sync Now"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLinksModalConnection(c)}
                          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Manage Campaign Links
                        </button>
                        {c.status !== "DISCONNECTED" && (
                          <button
                            type="button"
                            onClick={() => setDisconnectTarget(c)}
                            className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!linksModalConnection}
        onClose={() => setLinksModalConnection(null)}
        title={linksModalConnection ? `Campaign Links — ${linksModalConnection.accountName}` : ""}
        maxWidthClass="max-w-xl"
      >
        {linksModalConnection && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Only linked external campaigns receive synced metrics — an external campaign with no link is listed but
              never written to.
            </p>
            {linksModalConnection.campaignLinks.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No external campaigns found yet — this connection hasn&apos;t been synced/refreshed, or the account has no
                campaigns.
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {linksModalConnection.campaignLinks.map((l) => (
                  <div key={l.id} className="flex items-center gap-3">
                    <div className="w-56 shrink-0 truncate text-sm text-zinc-700 dark:text-zinc-300" title={l.externalCampaignName}>
                      {l.externalCampaignName}
                    </div>
                    <select
                      value={l.localCampaign?.id ?? ""}
                      onChange={(e) => setLink(linksModalConnection.id, l.id, e.target.value || null)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value="">— Not linked —</option>
                      {localCampaigns?.map((lc) => (
                        <option key={lc.id} value={lc.id}>
                          {lc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!disconnectTarget}
        title="Disconnect ad account?"
        message={`Stop syncing "${disconnectTarget?.accountName}"? Its previously-synced metrics stay in place — only future syncing stops. You can reconnect later.`}
        confirmLabel="Disconnect"
        isDangerous
        onConfirm={confirmDisconnect}
        onCancel={() => setDisconnectTarget(null)}
      />
    </div>
  );
}

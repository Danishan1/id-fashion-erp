"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { Badge, CARD, INT_API, KEY_STATE, StatusBadge, WEBHOOK_HEALTH, send, useApi, type IntegrationDetail, type UsageRow } from "./integration-ui";

/** Phase 16 — one integration: status and why, capabilities, credential reference, usage / deliveries / callbacks, sync checkpoints, history, actions. */
export function SmIntegrationDetailClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const api = `${INT_API}/${id}`;
  const { data: d, error, reload } = useApi<IntegrationDetail>(api);
  const [confirm, setConfirm] = useState<"enable" | "disable" | "check" | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "err"; text: string; checks?: { label: string; ok: boolean; detail?: string }[] | null } | null>(null);

  if (error && !d) return <ErrorState message={error} onRetry={reload} />;
  if (!d) return <LoadingState />;

  const managedHere = d.managedIn === "SALES_MARKETING";
  const enabled = d.status !== "DISABLED";
  const canCheck = ["API_CLIENT", "WEBHOOK_SUBSCRIPTION", "DELIVERY_PROVIDER"].includes(d.kind);
  const run = async (action: "enable" | "disable" | "check") => {
    setBusy(true);
    setResult(null);
    try {
      const r = await send<{ message: string; checks: { label: string; ok: boolean; detail?: string }[] | null }>(api, "POST", { action });
      setResult({ tone: "ok", text: r.message, checks: r.checks });
      reload();
    } catch (e) {
      setResult({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-4">
      {result && (
        <div role={result.tone === "err" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${result.tone === "err" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"}`}>
          {result.text}
          {result.checks && (
            <ul className="mt-2 space-y-0.5">
              {result.checks.map((c) => (
                <li key={c.label}>
                  <span aria-hidden>{c.ok ? "✓" : "✗"}</span> {c.label}
                  <span className="sr-only">{c.ok ? " (passed)" : " (failed)"}</span>
                  {c.detail ? ` — ${c.detail}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={d.statusLabel} tone={d.statusTone} />
              {d.liveVerified === false && <Badge tone="amber">Not live-verified against the real provider</Badge>}
            </div>
            <p className="text-sm">
              {d.kindLabel} · {d.providerLabel}
            </p>
            {d.statusReason && <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.statusReason}</p>}
            <p className="text-xs text-zinc-500">
              Status since <ClientDateTime value={d.statusChangedAt} />
              {d.lastSuccessAt && (
                <>
                  {" "}
                  · last success <ClientDateTime value={d.lastSuccessAt} />
                </>
              )}
            </p>
            {d.lastError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {d.lastError}
                {d.lastErrorAt && (
                  <span className="text-xs">
                    {" "}
                    (<ClientDateTime value={d.lastErrorAt} />)
                  </span>
                )}
              </p>
            )}
          </div>
          {!managedHere ? (
            d.manageHref && (
              <Link href={d.manageHref} className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
                Manage in CRM Settings
              </Link>
            )
          ) : (
            canEdit &&
            d.status !== "REVOKED" && (
              <div className="flex flex-wrap gap-2">
                {canCheck && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm("check")}>
                    {d.kind === "WEBHOOK_SUBSCRIPTION" ? "Send test event" : "Run check"}
                  </Button>
                )}
                <Button size="sm" variant={enabled ? "danger" : "primary"} disabled={busy} onClick={() => setConfirm(enabled ? "disable" : "enable")}>
                  {enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            )
          )}
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">Can do</dt>
            <dd>{d.capabilities.map((c) => c.label).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Authentication</dt>
            <dd>{d.authMethod}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Credential (reference only — the value is never shown)</dt>
            <dd>
              <code className="text-xs">{d.credentialRef ?? "—"}</code>
              {d.credentialRotatedAt && (
                <span className="text-xs text-zinc-500">
                  {" "}
                  · rotated <ClientDateTime value={d.credentialRotatedAt} />
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {d.detail.apiKey && (
        <section className={CARD}>
          <h2 className="font-semibold">API key</h2>
          <p className="mt-1 text-sm">
            <code>{d.detail.apiKey.keyPreview}</code> · <StatusBadge label={KEY_STATE[d.detail.apiKey.state].label} tone={KEY_STATE[d.detail.apiKey.state].tone} /> · acts as {d.detail.apiKey.actsAs.name} · {d.detail.apiKey.rateLimitPerMinute}/min
          </p>
          <p className="mt-1 text-xs text-zinc-500">Scopes: {d.detail.apiKey.scopes.join(", ")}</p>
        </section>
      )}
      {d.detail.usage24h && <UsageTable title="API calls — last 24 hours" rows={d.detail.usage24h} />}
      {d.detail.usage7d && <UsageTable title="API calls — last 7 days" rows={d.detail.usage7d} />}
      {d.detail.checkpoints && d.detail.checkpoints.length > 0 && (
        <section className={CARD}>
          <h2 className="font-semibold">Sync</h2>
          {(d.detail.openConflicts ?? 0) > 0 && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{d.detail.openConflicts} open conflict(s) — see the Sync conflicts tab.</p>}
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-medium">Stream</th>
                <th className="py-1 pr-3 font-medium">Created</th>
                <th className="py-1 pr-3 font-medium">Updated</th>
                <th className="py-1 pr-3 font-medium">Unchanged</th>
                <th className="py-1 pr-3 font-medium">Stale ignored</th>
                <th className="py-1 pr-3 font-medium">Conflicts</th>
                <th className="py-1 pr-3 font-medium">Failed</th>
                <th className="py-1 pr-3 font-medium">Latest source time</th>
              </tr>
            </thead>
            <tbody>
              {d.detail.checkpoints.map((c) => (
                <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 pr-3">
                    <code className="text-xs">{c.stream}</code>
                    {c.lastError && <div className="text-xs text-red-600 dark:text-red-400">{c.lastError}</div>}
                  </td>
                  <td className="py-1 pr-3">{c.created}</td>
                  <td className="py-1 pr-3">{c.updated}</td>
                  <td className="py-1 pr-3">{c.unchanged}</td>
                  <td className="py-1 pr-3">{c.staleIgnored}</td>
                  <td className="py-1 pr-3">{c.conflicts}</td>
                  <td className="py-1 pr-3">{c.failed}</td>
                  <td className="py-1 pr-3 text-xs">{c.lastSourceAt ? <ClientDateTime value={c.lastSourceAt} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {d.detail.subscription && (
        <section className={CARD}>
          <h2 className="font-semibold">Webhook</h2>
          <p className="mt-1 text-sm">
            <code className="text-xs">{d.detail.subscription.url}</code> · <StatusBadge label={WEBHOOK_HEALTH[d.detail.subscription.health].label} tone={WEBHOOK_HEALTH[d.detail.subscription.health].tone} />
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Events: {d.detail.subscription.eventTypes.join(", ")} · deliveries:{" "}
            {Object.entries(d.detail.subscription.deliveryCounts ?? {})
              .map(([k, v]) => `${v} ${k.toLowerCase()}`)
              .join(", ") || "none"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">The delivery log, redeliver and secret rotation are on the Outgoing webhooks tab.</p>
        </section>
      )}
      {d.detail.callbacks24h && (
        <section className={CARD}>
          <h2 className="font-semibold">Provider callbacks — last 24 hours</h2>
          <p className="mt-1 text-sm">
            {d.detail.callbacks24h.accepted} accepted · {d.detail.callbacks24h.rejected} failed verification · {d.detail.callbacks24h.waitingToProcess} waiting to be processed · {d.detail.callbacks24h.failedToProcess} failed to process
          </p>
          {d.detail.notLiveVerified && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">This provider adapter follows the provider&apos;s documentation but hasn&apos;t been tested against a real account in this build. Run a check and a test send before relying on it.</p>}
        </section>
      )}

      <section className={CARD}>
        <h2 className="font-semibold">History</h2>
        {d.history.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">No recorded changes.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {d.history.map((h) => (
              <li key={h.id}>
                <ClientDateTime value={h.at} /> · {h.by ?? "System"} · {h.action.toLowerCase()}
                {h.changed.length > 0 && <span className="text-xs text-zinc-500"> ({h.changed.join(", ")})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmModal
        open={confirm !== null}
        title={confirm === "disable" ? "Disable this integration?" : confirm === "enable" ? "Enable this integration?" : "Run the check?"}
        message={
          confirm === "disable"
            ? d.kind === "API_CLIENT"
              ? "Calls with this key are refused until it is enabled again."
              : d.kind === "WEBHOOK_SUBSCRIPTION"
                ? "No more events are sent and queued deliveries are cancelled. Re-enabling doesn't replay what happened meanwhile."
                : "The connection stops sending. Scheduled or running sends must be cancelled first."
            : confirm === "enable"
              ? "It starts working again from now."
              : d.kind === "WEBHOOK_SUBSCRIPTION"
                ? "A signed, clearly-marked test event is sent to the endpoint now."
                : d.kind === "DELIVERY_PROVIDER"
                  ? "The provider's connection test runs now (no message is sent)."
                  : "Checks the key, the user it acts as and each scope's permission."
        }
        confirmLabel={confirm === "disable" ? "Disable" : confirm === "enable" ? "Enable" : "Run"}
        isDangerous={confirm === "disable"}
        isBusy={busy}
        onConfirm={() => confirm && run(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function UsageTable({ title, rows }: { title: string; rows: UsageRow[] }) {
  return (
    <section className={CARD}>
      <h2 className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-500">No calls.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-3 font-medium">Endpoint</th>
              <th className="py-1 pr-3 font-medium">Calls</th>
              <th className="py-1 pr-3 font-medium">Errors</th>
              <th className="py-1 pr-3 font-medium">Refused</th>
              <th className="py-1 pr-3 font-medium">Rate-limited</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.endpoint} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-3 font-mono text-xs">{r.endpoint}</td>
                <td className="py-1 pr-3">{r.requests}</td>
                <td className="py-1 pr-3">{r.errors}</td>
                <td className="py-1 pr-3">{r.refused}</td>
                <td className="py-1 pr-3">{r.rateLimited}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

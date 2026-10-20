"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CopyableCode, SecretOnce } from "@/components/crm/SecretOnce";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/date-format";
import {
  RECEIVER_EXAMPLE_NODE,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_MAX_SUBSCRIPTIONS,
  WEBHOOK_TIMEOUT_SECONDS,
  sampleEnvelope,
} from "@/modules/crm/webhooks-out/webhook-events";
import { useSettingsList } from "./useSettingsList";

/**
 * Phase 22 — CRM Settings → Outgoing webhooks. The signing secret is shown
 * once, in the create / rotate response (SecretOnce); nothing on this screen
 * can read an existing secret back — rows only say "Secret configured".
 */

const API = "/api/v1/crm/settings/webhook-subscriptions";

export interface SubscriptionRow {
  id: string;
  name: string;
  description: string | null;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  version: number;
  secret: { configured: boolean; masked: string; rotatedAt: string | null };
  health: "DISABLED" | "NEEDS_ATTENTION" | "LAST_FAILED" | "HEALTHY" | "NO_DELIVERIES";
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  eventId: string | null;
  eventType: string;
  isTest: boolean;
  status: "PENDING" | "RETRYING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  statusLabel: string;
  attempts: number;
  nextAttemptAt: string | null;
  responseStatus: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

const HEALTH: Record<SubscriptionRow["health"], { label: string; tone: CrmBadgeTone }> = {
  HEALTHY: { label: "Delivering", tone: "green" },
  NO_DELIVERIES: { label: "No deliveries yet", tone: "neutral" },
  LAST_FAILED: { label: "Last delivery failed", tone: "amber" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "red" },
  DISABLED: { label: "Disabled", tone: "neutral" },
};
const DELIVERY_TONE: Record<DeliveryRow["status"], CrmBadgeTone> = { PENDING: "indigo", RETRYING: "amber", SUCCEEDED: "green", FAILED: "red", CANCELLED: "neutral" };

const EVENT_LABEL = new Map<string, string>(WEBHOOK_EVENTS.map((e) => [e.type, e.label]));
const EVENT_GROUPS = WEBHOOK_EVENTS.reduce<Record<string, typeof WEBHOOK_EVENTS>>((acc, e) => {
  (acc[e.group] ??= []).push(e);
  return acc;
}, {});

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.length > 1 ? (u.pathname.length > 28 ? `${u.pathname.slice(0, 28)}…` : u.pathname) : ""}`;
  } catch {
    return url;
  }
}

// ── Create / edit ────────────────────────────────────────────────

function EventPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [filter, setFilter] = useState("");
  const set = new Set(value);
  const toggle = (types: string[], on: boolean) => {
    const next = new Set(value);
    for (const t of types) {
      if (on) next.add(t);
      else next.delete(t);
    }
    onChange(WEBHOOK_EVENTS.map((e) => e.type).filter((t) => next.has(t)));
  };
  const q = filter.trim().toLowerCase();
  return (
    <div className="space-y-2">
      <input aria-label="Filter events" className={textInputClass()} placeholder="Filter events…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        {Object.entries(EVENT_GROUPS).map(([group, events]) => {
          const shown = events.filter((e) => !q || e.label.toLowerCase().includes(q) || e.type.includes(q));
          if (!shown.length) return null;
          const all = shown.every((e) => set.has(e.type));
          return (
            <fieldset key={group} className="space-y-1">
              <legend className="flex w-full items-center justify-between text-xs font-semibold uppercase text-zinc-500">
                <span>{group}</span>
                <button type="button" className="text-xs font-normal normal-case text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => toggle(shown.map((e) => e.type), !all)}>
                  {all ? "Clear" : "Select all"}
                </button>
              </legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {shown.map((e) => (
                  <label key={e.type} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={set.has(e.type)} onChange={(ev) => toggle([e.type], ev.target.checked)} />
                    <span>
                      {e.label} <code className="text-[11px] text-zinc-500">{e.type}</code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">{value.length ? `${value.length} selected` : "Choose at least one event."}</p>
    </div>
  );
}

function SubscriptionModal({ row, onClose, onSaved }: { row: SubscriptionRow | null; onClose: () => void; onSaved: (created?: { name: string; url: string; secret: string }) => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [url, setUrl] = useState(row?.url ?? "https://");
  const [eventTypes, setEventTypes] = useState<string[]>(row?.eventTypes ?? []);
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body = { name, description: description || null, url, eventTypes, isActive };
    const res = row
      ? await crmRequest<SubscriptionRow>(`${API}/${row.id}`, { method: "PATCH", body: { ...body, version: row.version }, toast: "off" })
      : await crmRequest<SubscriptionRow & { secretOnce: string }>(API, { method: "POST", body, toast: "off" });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    onSaved(row ? undefined : { name: res.data.name, url: res.data.url, secret: (res.data as SubscriptionRow & { secretOnce: string }).secretOnce });
  };
  return (
    <Modal open onClose={onClose} title={row ? `Edit "${row.name}"` : "Add outgoing webhook"} maxWidthClass="max-w-3xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="ow-name" required error={fieldErrors.name}>
            <input id="ow-name" className={textInputClass(!!fieldErrors.name)} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus placeholder="e.g. Data warehouse" />
          </FormField>
          <FormField label="Endpoint URL" htmlFor="ow-url" required error={fieldErrors.url}>
            <input id="ow-url" type="url" inputMode="url" className={textInputClass(!!fieldErrors.url)} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} required placeholder="https://hooks.example.com/crm" />
          </FormField>
        </div>
        <p className="-mt-2 text-xs text-zinc-500">https only, on a public address (ports 443 or 8443). Redirects are not followed — register the final URL. Don&apos;t put passwords or tokens in the URL; verify the signature instead.</p>
        <FormField label="Description" htmlFor="ow-desc">
          <input id="ow-desc" className={textInputClass()} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What receives these events (optional)" />
        </FormField>
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Events</p>
          <EventPicker value={eventTypes} onChange={setEventTypes} />
          {fieldErrors.eventTypes && <p className="mt-1 text-xs text-red-600">{fieldErrors.eventTypes}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active — send events as they happen
        </label>
        {row && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Signing secret: <CrmBadge label="Secret configured" tone="green" /> <code className="text-xs">{row.secret.masked}</code> — use <strong>Rotate secret</strong> in the list to replace it.
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…" disabled={!eventTypes.length}>
            {row ? "Save" : "Create and show secret"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Test & deliveries ────────────────────────────────────────────

function TestModal({ row, onClose, onDone }: { row: SubscriptionRow; onClose: () => void; onDone: () => void }) {
  const [eventType, setEventType] = useState(row.eventTypes[0] ?? "lead.created");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; responseStatus: number | null; durationMs: number | null; message: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await crmRequest<{ status: string; responseStatus: number | null; durationMs: number | null; message: string | null }>(`${API}/${row.id}/test`, { method: "POST", body: { eventType }, toast: "off" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setResult(res.data);
    onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Send a test event to "${row.name}"`} maxWidthClass="max-w-2xl">
      <div className="mt-4 space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Sends one signed request now, with <code>&quot;test&quot;: true</code> and sample data (no real records). It is recorded in the delivery log and is not retried.
        </p>
        <FormField label="Event" htmlFor="ow-test-event">
          <select id="ow-test-event" className={textInputClass()} value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {row.eventTypes.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABEL.get(t) ?? t}
              </option>
            ))}
          </select>
        </FormField>
        <CopyableCode title="Body that will be sent (id and timestamps are generated)" code={JSON.stringify(sampleEnvelope(eventType, true), null, 2)} />
        <div role="status" aria-live="polite">
          {result &&
            (result.status === "SUCCEEDED" ? (
              <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                Delivered — your endpoint answered HTTP {result.responseStatus}
                {result.durationMs != null ? ` in ${result.durationMs} ms` : ""}.
              </p>
            ) : (
              <p className="rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">Not delivered: {result.message ?? "the endpoint did not accept the request."}</p>
            ))}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={send} isLoading={busy} loadingLabel="Sending…">
            Send test event
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const PAGE = 25;

function DeliveriesModal({ row, canEdit, onClose }: { row: SubscriptionRow; canEdit: boolean; onClose: () => void }) {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [take, setTake] = useState(PAGE);
  useEffect(() => {
    let cancelled = false;
    crmRequest<{ rows: DeliveryRow[]; totalCount: number }>(`${API}/${row.id}/deliveries?take=${take}${status ? `&status=${status}` : ""}`).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setError(res.error.message);
      setError(null);
      setRows(res.data.rows);
      setTotal(res.data.totalCount);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id, status, take, tick]);
  const redeliver = async (d: DeliveryRow) => {
    const res = await crmRequest(`${API}/${row.id}/deliveries/${d.id}/redeliver`, { method: "POST", successMessage: "Queued — it will be sent within about 15 seconds." });
    if (res.ok) setTick((t) => t + 1);
  };
  return (
    <Modal open onClose={onClose} title={`Delivery log — ${row.name}`} maxWidthClass="max-w-5xl">
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ow-dl-status" className="text-sm text-zinc-600 dark:text-zinc-300">
            Status
          </label>
          <select id="ow-dl-status" className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="PENDING">Queued</option>
            <option value="RETRYING">Retrying</option>
            <option value="SUCCEEDED">Delivered</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <Button variant="secondary" size="xs" onClick={() => setTick((t) => t + 1)}>
            Refresh
          </Button>
          <span className="text-xs text-zinc-500">Kept for 30 days. Shows outcomes only — never the request body or your endpoint&apos;s response.</span>
        </div>
        {error ? (
          <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
        ) : !rows ? (
          <CrmLoadingState />
        ) : rows.length === 0 ? (
          <CrmEmptyState title="No deliveries" description="Deliveries appear here once a subscribed event happens (or after a test event)." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(d.createdAt)}</td>
                    <td className="px-3 py-2">
                      {EVENT_LABEL.get(d.eventType) ?? d.eventType}
                      {d.isTest && <span className="ml-1 text-xs text-zinc-500">(test)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <CrmBadge label={d.statusLabel} tone={DELIVERY_TONE[d.status]} />
                      {d.nextAttemptAt && <div className="text-xs text-zinc-500">next try {formatDateTime(d.nextAttemptAt)}</div>}
                    </td>
                    <td className="px-3 py-2">{d.attempts}</td>
                    <td className="px-3 py-2 text-xs">
                      {d.responseStatus ? `HTTP ${d.responseStatus}` : ""}
                      {d.durationMs != null ? ` · ${d.durationMs} ms` : ""}
                      {d.errorMessage && <div className="text-red-700 dark:text-red-300">{d.errorMessage}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && row.isActive && !d.isTest && (d.status === "FAILED" || d.status === "SUCCEEDED" || d.status === "CANCELLED") && (
                        <Button variant="secondary" size="xs" onClick={() => redeliver(d)}>
                          Redeliver
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length < total && (
          <Button variant="secondary" size="xs" onClick={() => setTake((t) => t + PAGE)}>
            Show more ({total - rows.length} more)
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ── Developer guide ──────────────────────────────────────────────

export function OutgoingWebhookGuide() {
  const sample = useMemo(() => JSON.stringify(sampleEnvelope("lead.status_changed", false), null, 2), []);
  return (
    <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold">How to receive these webhooks (for developers)</summary>
      <div className="mt-3 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create an HTTPS endpoint that accepts <code>POST</code> with a JSON body, and keep the raw body for signature checks.</li>
          <li>
            Verify <code>X-CRM-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>: compute HMAC-SHA256 of <code>&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</code> with your signing secret, compare in constant time, and reject timestamps older than 5 minutes.
          </li>
          <li>
            De-duplicate on the <code>Idempotency-Key</code> header (one value per delivery, identical on every retry). <code>X-CRM-Event-Id</code> is the CRM event id; <code>X-CRM-Event-Type</code> and <code>X-CRM-Delivery-Attempt</code> are informational.
          </li>
          <li>Answer with any 2xx within {WEBHOOK_TIMEOUT_SECONDS} seconds and do slow work afterwards.</li>
        </ol>
        <p>
          <strong>Retries:</strong> timeouts, network errors, HTTP 408, 429 and 5xx are retried after 1 min, 5 min, 30 min, 2 h and 6 h ({WEBHOOK_MAX_ATTEMPTS} attempts in all), then marked Failed. Other answers (4xx, redirects) fail at once. Delivery is
          at-least-once and not guaranteed: an endpoint that stays down past the last retry misses the event (you can redeliver from the log for 30 days), and events can arrive out of order — use <code>occurredAt</code>.
        </p>
        <p>
          <strong>Payload:</strong> the body is a small envelope that identifies the record and what happened. Fetch full details with the CRM API if you need them.
        </p>
        <CopyableCode title="Example body" code={sample} />
        <CopyableCode title="Example receiver (Node.js / Express)" code={RECEIVER_EXAMPLE_NODE} />
        <p className="text-xs text-zinc-500">Never log the signing secret or put it in source control; store it in your secret manager. If it leaks, rotate it here — the old one stops working immediately.</p>
      </div>
    </details>
  );
}

// ── Tab ──────────────────────────────────────────────────────────

export function OutgoingWebhooksTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<SubscriptionRow>(API);
  const [editing, setEditing] = useState<SubscriptionRow | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; url: string; secret: string; rotated: boolean } | null>(null);
  const [testing, setTesting] = useState<SubscriptionRow | null>(null);
  const [logFor, setLogFor] = useState<SubscriptionRow | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rotate" | "delete"; row: SubscriptionRow } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(
    async (s: SubscriptionRow) => {
      const res = await crmRequest(`${API}/${s.id}`, { method: "PATCH", body: { version: s.version, isActive: !s.isActive }, successMessage: s.isActive ? "Subscription disabled — queued deliveries are cancelled." : "Subscription enabled — new events are sent from now on." });
      if (res.ok) reload();
    },
    [reload]
  );

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    if (confirm.kind === "rotate") {
      const res = await crmRequest<SubscriptionRow & { secretOnce: string }>(`${API}/${confirm.row.id}/rotate-secret`, { method: "POST", body: { version: confirm.row.version }, toast: "errors" });
      if (res.ok) setRevealed({ name: res.data.name, url: res.data.url, secret: res.data.secretOnce, rotated: true });
    } else {
      await crmRequest(`${API}/${confirm.row.id}`, { method: "DELETE", successMessage: "Subscription deleted." });
    }
    setBusy(false);
    setConfirm(null);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Send CRM events — a lead created, a status or stage changed, a task completed — to your own systems as signed HTTPS requests, with automatic retries and a delivery log. Up to {WEBHOOK_MAX_SUBSCRIPTIONS} subscriptions. For a one-off call inside a
          process, use a workflow&apos;s &quot;Call a webhook&quot; action instead.
        </p>
        {canEdit && rows.length < WEBHOOK_MAX_SUBSCRIPTIONS && <Button onClick={() => setEditing("new")}>Add outgoing webhook</Button>}
      </div>

      {revealed && (
        <SecretOnce label={`${revealed.rotated ? "New signing secret" : "Signing secret"} for "${revealed.name}"`} value={revealed.secret} onDone={() => setRevealed(null)}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Store it in the receiving system&apos;s secret manager (for example as <code>CRM_WEBHOOK_SECRET</code>) and verify <code>X-CRM-Signature</code> on every request — see &quot;How to receive these webhooks&quot; below.
            {revealed.rotated && " The previous secret has stopped working: update the receiver now, or its signature checks will fail."}
          </p>
        </SecretOnce>
      )}

      {rows.length === 0 ? (
        <CrmEmptyState title="No outgoing webhooks yet" description="Add one for each system that should hear about CRM changes." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Endpoint</th>
                <th className="px-3 py-2">Events</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Signing secret</th>
                <th className="px-3 py-2">Last delivery</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    {s.description && <div className="text-xs text-zinc-500">{s.description}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <code className="break-all text-xs" title={s.url}>
                      {hostOf(s.url)}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-xs" title={s.eventTypes.map((t) => EVENT_LABEL.get(t) ?? t).join(", ")}>
                    {s.eventTypes.length === 1 ? (EVENT_LABEL.get(s.eventTypes[0]) ?? s.eventTypes[0]) : `${s.eventTypes.length} events`}
                  </td>
                  <td className="px-3 py-2">
                    <CrmBadge label={HEALTH[s.health].label} tone={HEALTH[s.health].tone} />
                    {s.health === "NEEDS_ATTENTION" && <div className="text-xs text-red-700 dark:text-red-300">{s.consecutiveFailures} failures in a row</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="text-emerald-700 dark:text-emerald-300">Secret configured</span>
                    <div className="text-zinc-500">{s.secret.rotatedAt ? `Rotated ${formatDateTime(s.secret.rotatedAt)}` : `Created ${formatDateTime(s.createdAt)}`}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.lastDeliveryAt ? formatDateTime(s.lastDeliveryAt) : "—"}
                    {s.lastDeliveryStatus === "FAILED" && s.lastError && <div className="text-red-700 dark:text-red-300">{s.lastError}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="secondary" size="xs" onClick={() => setLogFor(s)}>
                        Deliveries
                      </Button>
                      {canEdit && (
                        <>
                          <Button variant="secondary" size="xs" onClick={() => setTesting(s)}>
                            Test
                          </Button>
                          <Button variant="secondary" size="xs" onClick={() => setEditing(s)}>
                            Edit
                          </Button>
                          <Button variant="secondary" size="xs" onClick={() => toggle(s)}>
                            {s.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button variant="secondary" size="xs" onClick={() => setConfirm({ kind: "rotate", row: s })}>
                            Rotate secret
                          </Button>
                          <Button variant="secondary" size="xs" onClick={() => setConfirm({ kind: "delete", row: s })}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OutgoingWebhookGuide />

      {editing && (
        <SubscriptionModal
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            if (created) setRevealed({ ...created, rotated: false });
            reload();
          }}
        />
      )}
      {testing && <TestModal row={testing} onClose={() => setTesting(null)} onDone={reload} />}
      {logFor && <DeliveriesModal row={logFor} canEdit={canEdit} onClose={() => setLogFor(null)} />}
      {confirm && (
        <ConfirmModal
          open
          title={confirm.kind === "rotate" ? `Rotate the signing secret of "${confirm.row.name}"?` : `Delete "${confirm.row.name}"?`}
          message={
            confirm.kind === "rotate"
              ? "A new secret is generated and shown once. The current secret stops working immediately, so the receiver will reject deliveries until it has the new one."
              : "Deliveries stop, queued ones are dropped and the delivery log is deleted. This can't be undone."
          }
          confirmLabel={confirm.kind === "rotate" ? "Rotate secret" : "Delete"}
          isDangerous
          isBusy={busy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

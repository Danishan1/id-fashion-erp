"use client";

import { useState } from "react";
import { SecretOnce } from "@/components/crm/SecretOnce";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SM_PUBLIC_EVENTS, SM_PUBLIC_EVENT_TYPES, type SmPublicEventType } from "@/modules/sales-marketing/integrations/integration-registry";
import { CARD, INT_API, StatusBadge, WEBHOOK_HEALTH, send, useApi, type DeliveryRow, type WebhookDto } from "./integration-ui";

const HOOKS_API = `${INT_API}/webhooks`;
const GROUPS = [...new Set(SM_PUBLIC_EVENT_TYPES.map((t) => SM_PUBLIC_EVENTS[t].group))];

/** Phase 16 — outgoing webhooks for S&M events (same engine and signing as CRM webhooks). */
export function WebhooksPanel({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const { data, error, reload } = useApi<WebhookDto[]>(HOOKS_API);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rotate" | "delete"; sub: WebhookDto } | null>(null);
  const [logOf, setLogOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: "ok", text });
      reload();
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Send Sales &amp; Marketing events (quotations, campaigns, budgets, attribution, jobs, workflows) to another system&apos;s HTTPS endpoint. Each request is signed; failed deliveries are retried and logged. Delivery is at-least-once — receivers must ignore repeats using the Idempotency-Key header. See the API &amp; webhook guide tab.
      </p>
      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${msg.tone === "err" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"}`}>
          {msg.text}
        </p>
      )}
      {secret && <SecretOnce label={secret.label} value={secret.value} onDone={() => setSecret(null)} />}
      {canEdit && !creating && !secret && <Button onClick={() => setCreating(true)}>New webhook</Button>}
      {creating && (
        <CreateWebhookForm
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={(body) =>
            act(async () => {
              const r = await send<WebhookDto & { secretOnce: string }>(HOOKS_API, "POST", body);
              setCreating(false);
              setSecret({ label: `Signing secret for "${r.name}" — shown once`, value: r.secretOnce });
            })
          }
        />
      )}
      {data.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No outgoing webhooks yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((s) => (
            <li key={s.id} className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <StatusBadge label={WEBHOOK_HEALTH[s.health].label} tone={WEBHOOK_HEALTH[s.health].tone} />
                  </div>
                  <code className="block truncate text-xs text-zinc-500">{s.url}</code>
                  <div className="mt-1 text-xs text-zinc-500">
                    {s.eventTypes.length} event type{s.eventTypes.length === 1 ? "" : "s"} · secret {s.secret.masked}
                    {s.secret.rotatedAt && (
                      <>
                        {" "}
                        (rotated <ClientDateTime value={s.secret.rotatedAt} />)
                      </>
                    )}
                    {s.lastSuccessAt && (
                      <>
                        {" "}
                        · last delivered <ClientDateTime value={s.lastSuccessAt} />
                      </>
                    )}
                  </div>
                  {s.lastError && s.health !== "HEALTHY" && <div className="text-xs text-red-600 dark:text-red-400">{s.lastError}</div>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="xs" variant="secondary" onClick={() => setLogOf(logOf === s.id ? null : s.id)}>
                    {logOf === s.id ? "Hide deliveries" : "Deliveries"}
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        size="xs"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            const r = await send<{ status: string; responseStatus: number | null; durationMs: number | null; message: string | null }>(`${HOOKS_API}/${s.id}/test`, "POST", {});
                            return r.status === "SUCCEEDED" ? `Test event delivered — HTTP ${r.responseStatus}${r.durationMs !== null ? ` in ${r.durationMs} ms` : ""}.` : `Test event not delivered: ${r.message ?? r.status}`;
                          })
                        }
                      >
                        Send test
                      </Button>
                      <Button size="xs" variant="secondary" disabled={busy} onClick={() => act(async () => void (await send(`${HOOKS_API}/${s.id}`, "PATCH", { version: s.version, isActive: !s.isActive })))}>
                        {s.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button size="xs" variant="secondary" disabled={busy} onClick={() => setConfirm({ kind: "rotate", sub: s })}>
                        Rotate secret
                      </Button>
                      <Button size="xs" variant="danger" disabled={busy} onClick={() => setConfirm({ kind: "delete", sub: s })}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {logOf === s.id && <DeliveryLog subId={s.id} canApprove={canApprove} />}
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        open={confirm !== null}
        title={confirm?.kind === "rotate" ? "Rotate the signing secret?" : "Delete this webhook?"}
        message={confirm?.kind === "rotate" ? "The old secret stops working immediately: update the receiver right after. The new secret is shown once." : "No more events are sent. Its delivery log is deleted too."}
        confirmLabel={confirm?.kind === "rotate" ? "Rotate secret" : "Delete webhook"}
        isDangerous={confirm?.kind === "delete"}
        isBusy={busy}
        onConfirm={() =>
          confirm &&
          act(async () => {
            if (confirm.kind === "delete") {
              await send(`${HOOKS_API}/${confirm.sub.id}`, "DELETE");
              return "Webhook deleted.";
            }
            const r = await send<WebhookDto & { secretOnce: string }>(`${HOOKS_API}/${confirm.sub.id}/rotate-secret`, "POST", { version: confirm.sub.version });
            setSecret({ label: `New signing secret for "${r.name}" — shown once`, value: r.secretOnce });
          })
        }
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function CreateWebhookForm({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<SmPublicEventType[]>([]);
  return (
    <form
      className={`${CARD} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ name, url, eventTypes: events });
      }}
    >
      <h3 className="font-semibold">New outgoing webhook</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block font-medium">Name</span>
          <input className={textInputClass()} value={name} required maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Endpoint URL (https, public address)</span>
          <input className={textInputClass()} value={url} required maxLength={2000} onChange={(e) => setUrl(e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Events</legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="text-xs font-semibold text-zinc-500">{g}</div>
              {SM_PUBLIC_EVENT_TYPES.filter((t) => SM_PUBLIC_EVENTS[t].group === g).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={events.includes(t)} onChange={(e) => setEvents(e.target.checked ? [...events, t] : events.filter((x) => x !== t))} />
                  {SM_PUBLIC_EVENTS[t].label}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim() || events.length === 0}>
          Create webhook
        </Button>
      </div>
    </form>
  );
}

function DeliveryLog({ subId, canApprove }: { subId: string; canApprove: boolean }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi<{ rows: DeliveryRow[]; totalCount: number }>(`${HOOKS_API}/${subId}/deliveries?take=25${status ? `&status=${status}` : ""}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <select aria-label="Delivery status" className={`${textInputClass()} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All deliveries</option>
          <option value="PENDING">Queued</option>
          <option value="RETRYING">Retrying</option>
          <option value="SUCCEEDED">Delivered</option>
          <option value="FAILED">Failed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <span className="text-xs text-zinc-500">{data.totalCount} total</span>
      </div>
      {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
      {data.rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No deliveries.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-3 font-medium">Event</th>
              <th className="py-1 pr-3 font-medium">Result</th>
              <th className="py-1 pr-3 font-medium">Attempts</th>
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((d) => (
              <tr key={d.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1 pr-3">
                  <code className="text-xs">{d.eventType}</code>
                  {d.isTest && <span className="ml-1 text-xs text-zinc-500">(test)</span>}
                </td>
                <td className="py-1 pr-3">
                  {d.statusLabel}
                  {d.responseStatus !== null && <span className="text-xs text-zinc-500"> · HTTP {d.responseStatus}</span>}
                  {d.errorMessage && <div className="text-xs text-red-600 dark:text-red-400">{d.errorMessage}</div>}
                  {d.nextAttemptAt && (
                    <div className="text-xs text-zinc-500">
                      next try <ClientDateTime value={d.nextAttemptAt} />
                    </div>
                  )}
                </td>
                <td className="py-1 pr-3">{d.attempts}</td>
                <td className="py-1 pr-3 text-xs">
                  <ClientDateTime value={d.lastAttemptAt ?? d.createdAt} />
                </td>
                <td className="py-1 text-right">
                  {canApprove && !d.isTest && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(d.status) && (
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy === d.id}
                      onClick={async () => {
                        setBusy(d.id);
                        setMsg(null);
                        try {
                          await send(`${HOOKS_API}/${subId}/deliveries/${d.id}/redeliver`, "POST");
                          reload();
                        } catch (e) {
                          setMsg((e as Error).message);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Redeliver
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { SecretOnce } from "@/components/crm/SecretOnce";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SM_API_SCOPES, SM_API_SCOPE_KEYS, type SmApiScope } from "@/modules/sales-marketing/integrations/integration-registry";
import { CARD, INT_API, KEY_STATE, StatusBadge, send, useApi, type ApiKeyDto } from "./integration-ui";

const KEYS_API = `${INT_API}/api-keys`;

/** Phase 16 — S&M API keys: create (full key shown once), edit scopes, rotate with a grace period, revoke. */
export function ApiKeysPanel({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const { data, error, reload } = useApi<ApiKeyDto[]>(KEYS_API);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [rotating, setRotating] = useState<ApiKeyDto | null>(null);
  const [grace, setGrace] = useState("0");
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A key lets another system call the Sales &amp; Marketing API. It acts as the person who created it: it can only do what its scopes allow <em>and</em> what that person may do right now. The full key is shown once — store it in the other system&apos;s secret store.
      </p>
      {msg && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {msg}
        </p>
      )}
      {secret && <SecretOnce label={secret.label} value={secret.value} onDone={() => setSecret(null)} />}
      {canEdit && !creating && !secret && <Button onClick={() => setCreating(true)}>New API key</Button>}
      {creating && (
        <CreateKeyForm
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={(body) =>
            act(async () => {
              const r = await send<ApiKeyDto & { keyOnce: string }>(KEYS_API, "POST", body);
              setCreating(false);
              setSecret({ label: `API key "${r.name}" — shown once`, value: r.keyOnce });
            })
          }
        />
      )}
      {data.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No API keys yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Scopes</th>
                <th className="px-3 py-2 font-medium">Acts as</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((k) => (
                <tr key={k.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <div className="font-medium">{k.name}</div>
                    <code className="text-xs text-zinc-500">{k.keyPreview}</code>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                      <StatusBadge label={KEY_STATE[k.state].label} tone={KEY_STATE[k.state].tone} />
                      {k.expiresAt && !k.revokedAt && (
                        <span>
                          expires <ClientDateTime value={k.expiresAt} />
                        </span>
                      )}
                      <span>· {k.rateLimitPerMinute}/min</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <ul className="space-y-0.5">
                      {k.scopes.map((s) => (
                        <li key={s}>
                          <code>{s}</code>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2">{k.actsAs.name}</td>
                  <td className="px-3 py-2 text-xs">{k.lastUsedAt ? <ClientDateTime value={k.lastUsedAt} /> : "Never"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {canEdit && k.state !== "REVOKED" && (
                        <Button size="xs" variant="secondary" disabled={busy} onClick={() => setRotating(k)}>
                          Rotate
                        </Button>
                      )}
                      {canApprove && k.state !== "REVOKED" && (
                        <Button size="xs" variant="danger" disabled={busy} onClick={() => setRevoking(k)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={rotating !== null} onClose={() => !busy && setRotating(null)} title="Rotate this key?">
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">A new key with the same scopes is issued (shown once) and acts as you. The old key stops working after the grace period.</p>
          <label className="block text-sm">
            <span className="block font-medium">Old key keeps working for</span>
            <select className={textInputClass()} value={grace} onChange={(e) => setGrace(e.target.value)}>
              <option value="0">No grace — stop it now</option>
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="72">72 hours</option>
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setRotating(null)}>
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                rotating &&
                act(async () => {
                  const r = await send<ApiKeyDto & { keyOnce: string }>(`${KEYS_API}/${rotating.id}`, "POST", { action: "rotate", graceHours: Number(grace) });
                  setRotating(null);
                  setSecret({ label: `New key for "${r.name}" — shown once`, value: r.keyOnce });
                })
              }
            >
              Rotate key
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={revoking !== null} onClose={() => !busy && setRevoking(null)} title="Revoke this key?">
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Calls with this key are refused immediately. This can&apos;t be undone — create a new key if needed.</p>
          <label className="block text-sm">
            <span className="block font-medium">Reason</span>
            <input className={textInputClass()} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setRevoking(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() =>
                revoking &&
                act(async () => {
                  await send(`${KEYS_API}/${revoking.id}`, "POST", { action: "revoke", reason });
                  setRevoking(null);
                  setReason("");
                })
              }
            >
              Revoke key
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateKeyForm({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<SmApiScope[]>(["sm.campaigns:read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [rate, setRate] = useState("");
  return (
    <form
      className={`${CARD} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ name, description, scopes, expiresAt: expiresAt || null, rateLimitPerMinute: rate ? Number(rate) : null });
      }}
    >
      <h3 className="font-semibold">New API key</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block font-medium">Name</span>
          <input className={textInputClass()} value={name} required maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website enquiry form" />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Description (optional)</span>
          <input className={textInputClass()} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Expires (optional)</span>
          <input type="date" className={textInputClass()} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block font-medium">Requests per minute (optional, 1–600)</span>
          <input type="number" min={1} max={600} className={textInputClass()} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="120" />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Scopes — give only what the other system needs</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {SM_API_SCOPE_KEYS.map((s) => (
            <label key={s} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
              <span>
                {SM_API_SCOPES[s].label} <code className="text-xs text-zinc-500">{s}</code>
                <span className="block text-xs text-zinc-500">
                  needs {SM_API_SCOPES[s].permission.module}.{SM_API_SCOPES[s].permission.action}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !name.trim() || scopes.length === 0}>
          Create key
        </Button>
      </div>
    </form>
  );
}

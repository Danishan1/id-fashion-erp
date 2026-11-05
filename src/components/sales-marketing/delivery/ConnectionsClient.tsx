"use client";

import { useState } from "react";
import { readApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CONSENT_POLICIES, MARKETING_PROVIDER_KEYS, MARKETING_PROVIDERS, type MarketingProviderKeyT, type ProviderDef } from "@/modules/sales-marketing/delivery/delivery-registry";
import { Badge, CARD, CHANNEL_LABELS, NotLiveVerifiedBadge, fmtDateTime, send, useApi } from "./delivery-ui";

interface Connection {
  id: string;
  code: string;
  name: string;
  description: string | null;
  channelType: string;
  providerKey: MarketingProviderKeyT;
  providerLabel: string;
  status: "ACTIVE" | "DISABLED";
  config: Record<string, string | number>;
  secretHints: Record<string, string>;
  consentPolicy: "OPT_OUT" | "OPT_IN";
  ratePerMinute: number;
  batchSize: number;
  liveVerified: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  circuitOpenUntil: string | null;
  webhookPath: string | null;
  version: number;
}

interface Draft {
  id: string | null;
  version: number;
  providerKey: MarketingProviderKeyT;
  code: string;
  name: string;
  description: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
  secretHints: Record<string, string>;
  consentPolicy: "OPT_OUT" | "OPT_IN";
  ratePerMinute: string;
  batchSize: string;
}

const emptyDraft = (providerKey: MarketingProviderKeyT = "SMTP"): Draft => ({
  id: null,
  version: 1,
  providerKey,
  code: "",
  name: "",
  description: "",
  config: {},
  secrets: {},
  secretHints: {},
  consentPolicy: "OPT_OUT",
  ratePerMinute: "60",
  batchSize: "50",
});

const toDraft = (c: Connection): Draft => ({
  id: c.id,
  version: c.version,
  providerKey: c.providerKey,
  code: c.code,
  name: c.name,
  description: c.description ?? "",
  config: Object.fromEntries(Object.entries(c.config).map(([k, v]) => [k, String(v)])),
  secrets: {},
  secretHints: c.secretHints,
  consentPolicy: c.consentPolicy,
  ratePerMinute: String(c.ratePerMinute),
  batchSize: String(c.batchSize),
});

/**
 * Sales & Marketing → Channel Connections (Phase 10): provider accounts used
 * to send campaign messages. Secrets are write-only — the server never sends
 * them back, only a masked hint.
 */
export function ConnectionsClient({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi<Connection[]>("/api/v1/sales-marketing/delivery/connections");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;

  const save = async () => {
    if (!draft) return;
    const def = MARKETING_PROVIDERS[draft.providerKey];
    const config: Record<string, string | number> = {};
    for (const f of def.fields) {
      const v = (draft.config[f.key] ?? "").trim();
      if (v === "") continue;
      config[f.key] = f.type === "number" ? Number(v) : v;
    }
    const secrets = Object.fromEntries(Object.entries(draft.secrets).filter(([, v]) => v !== ""));
    const common = { name: draft.name, description: draft.description, config, secrets, consentPolicy: draft.consentPolicy, ratePerMinute: Number(draft.ratePerMinute), batchSize: Number(draft.batchSize) };
    setBusy("save");
    setFormError(null);
    setFieldErrors({});
    try {
      const url = draft.id ? `/api/v1/sales-marketing/delivery/connections/${draft.id}` : "/api/v1/sales-marketing/delivery/connections";
      const body = draft.id ? { ...common, version: draft.version } : { ...common, code: draft.code, providerKey: draft.providerKey };
      const res = await fetch(url, { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await readApiError(res);
        setFormError(err.message);
        const raw = (await res.json().catch(() => null))?.error?.details?.fieldErrors as Record<string, string> | undefined;
        setFieldErrors({ ...Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, Array.isArray(v) ? v.join(" ") : String(v)])), ...(raw ?? {}) });
        return;
      }
      setDraft(null);
      reload();
    } catch {
      setFormError("Couldn't save. Check your connection.");
    } finally {
      setBusy(null);
    }
  };

  const act = async (c: Connection, key: string, fn: () => Promise<unknown>, okText?: (r: unknown) => string) => {
    setBusy(`${key}-${c.id}`);
    setNotice(null);
    try {
      const r = await fn();
      if (okText) setNotice({ id: c.id, text: okText(r), ok: true });
      reload();
    } catch (e) {
      setNotice({ id: c.id, text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-4">
      <div className={`${CARD} text-sm text-zinc-600 dark:text-zinc-400`}>
        A connection is one provider account that campaign messages go out through. None of these integrations has been run against a real provider account yet — they follow each provider&apos;s documentation and are tested with mocks. Use <strong>Test</strong> to check the credentials, then send a test message from a campaign before a real run.
      </div>
      {canEdit && (
        <div>
          <Button onClick={() => (setDraft(emptyDraft()), setFieldErrors({}), setFormError(null))}>New connection</Button>
        </div>
      )}
      {data.length === 0 ? (
        <EmptyState title="No connections yet" description="Add an SMTP, Brevo, MSG91 or WhatsApp Cloud API account to send campaign messages." />
      ) : (
        <div className="grid gap-3">
          {data.map((c) => (
            <div key={c.id} className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                    <span className="text-xs text-zinc-500">{c.code}</span>
                    <Badge tone={c.status === "ACTIVE" ? "green" : "zinc"}>{c.status === "ACTIVE" ? "Active" : "Disabled"}</Badge>
                    <NotLiveVerifiedBadge liveVerified={c.liveVerified} />
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {CHANNEL_LABELS[c.channelType] ?? c.channelType} · {c.providerLabel} · {c.consentPolicy === "OPT_IN" ? "Opt-in only" : "Opt-out respected"} · {c.ratePerMinute}/min
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {c.lastTestedAt ? (
                      <>
                        Last test {fmtDateTime(c.lastTestedAt)}: <span className={c.lastTestStatus === "OK" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{c.lastTestStatus === "OK" ? "OK" : "Failed"}</span>
                        {c.lastTestMessage ? ` — ${c.lastTestMessage}` : ""}
                      </>
                    ) : (
                      "Not tested yet"
                    )}
                    {c.circuitOpenUntil && new Date(c.circuitOpenUntil) > new Date() ? ` · Paused after repeated failures until ${fmtDateTime(c.circuitOpenUntil)}` : ""}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => act(c, "test", () => send(`/api/v1/sales-marketing/delivery/connections/${c.id}/test`, "POST"), (r) => (r as { message?: string })?.message ?? "Test finished.")}>
                      {busy === `test-${c.id}` ? "Testing…" : "Test"}
                    </Button>
                    <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => (setDraft(toDraft(c)), setFieldErrors({}), setFormError(null))}>
                      Edit
                    </Button>
                    <Button size="xs" variant={c.status === "ACTIVE" ? "danger" : "success"} disabled={!!busy} onClick={() => act(c, "status", () => send(`/api/v1/sales-marketing/delivery/connections/${c.id}/status`, "POST", { status: c.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }))}>
                      {c.status === "ACTIVE" ? "Disable" : "Enable"}
                    </Button>
                  </div>
                )}
              </div>
              {c.webhookPath && (
                <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Callback URL — give this to the provider for delivery reports{c.providerKey === "BREVO" ? " and unsubscribes" : ""}</div>
                  <code className="break-all text-zinc-800 dark:text-zinc-200">{origin}{c.webhookPath}</code>
                  <div className="mt-1 text-zinc-500">The provider must be able to reach this address from the internet. Treat it as a secret.</div>
                  {canEdit && (
                    <button type="button" className="mt-1 text-indigo-600 hover:underline dark:text-indigo-400" disabled={!!busy} onClick={() => confirm("The current callback URL will stop working at once. Continue?") && act(c, "rotate", () => send(`/api/v1/sales-marketing/delivery/connections/${c.id}/rotate-webhook`, "POST"), () => "New callback URL created — update it at the provider.")}>
                      Replace URL
                    </button>
                  )}
                </div>
              )}
              {notice?.id === c.id && <div className={`mt-2 text-sm ${notice.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{notice.text}</div>}
            </div>
          ))}
        </div>
      )}

      {draft && (
        <Modal open onClose={() => setDraft(null)} title={draft.id ? `Edit ${draft.name || "connection"}` : "New connection"} maxWidthClass="max-w-2xl">
          <ConnectionForm draft={draft} setDraft={setDraft} fieldErrors={fieldErrors} />
          {formError && <div className="mt-3 text-sm text-red-700 dark:text-red-400">{formError}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy === "save"}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ConnectionForm({ draft, setDraft, fieldErrors }: { draft: Draft; setDraft: (d: Draft) => void; fieldErrors: Record<string, string> }) {
  const def: ProviderDef = MARKETING_PROVIDERS[draft.providerKey];
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const fe = (k: string) => fieldErrors[k] ?? fieldErrors[`config.${k}`] ?? fieldErrors[`secrets.${k}`];
  return (
    <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
      {!draft.id && (
        <FormField label="Provider" htmlFor="providerKey" required>
          <select id="providerKey" className={textInputClass()} value={draft.providerKey} onChange={(e) => set({ providerKey: e.target.value as MarketingProviderKeyT, config: {}, secrets: {} })}>
            {MARKETING_PROVIDER_KEYS.map((k) => (
              <option key={k} value={k}>
                {MARKETING_PROVIDERS[k].label}
              </option>
            ))}
          </select>
        </FormField>
      )}
      <div className="rounded bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
        <div className="mb-1 flex items-center gap-2">
          <strong>{def.label}</strong>
          <NotLiveVerifiedBadge liveVerified={def.liveVerified} />
        </div>
        <p>{def.summary}</p>
        <ol className="mt-1 list-decimal pl-4">
          {def.setup.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {!draft.id && (
          <FormField label="Code" htmlFor="code" required error={fe("code")}>
            <input id="code" className={textInputClass(!!fe("code"))} value={draft.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="EMAIL-MAIN" />
          </FormField>
        )}
        <FormField label="Name" htmlFor="name" required error={fe("name")}>
          <input id="name" className={textInputClass(!!fe("name"))} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="description">
        <input id="description" className={textInputClass()} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.fields.map((f) => (
          <FormField key={f.key} label={f.label} htmlFor={`cfg-${f.key}`} required={f.required} error={fe(f.key)}>
            {f.type === "select" ? (
              <select id={`cfg-${f.key}`} className={textInputClass(!!fe(f.key))} value={draft.config[f.key] ?? ""} onChange={(e) => set({ config: { ...draft.config, [f.key]: e.target.value } })}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input id={`cfg-${f.key}`} type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"} className={textInputClass(!!fe(f.key))} placeholder={f.placeholder} value={draft.config[f.key] ?? ""} onChange={(e) => set({ config: { ...draft.config, [f.key]: e.target.value } })} />
            )}
            {f.help && <p className="mt-1 text-xs text-zinc-500">{f.help}</p>}
          </FormField>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {def.secretFields.map((f) => {
          const hint = draft.secretHints[f.key];
          return (
            <FormField key={f.key} label={f.label} htmlFor={`sec-${f.key}`} required={f.required && !hint} error={fe(f.key)}>
              <input id={`sec-${f.key}`} type="password" autoComplete="new-password" className={textInputClass(!!fe(f.key))} placeholder={hint ? `Saved (${hint}) — leave empty to keep` : ""} value={draft.secrets[f.key] ?? ""} onChange={(e) => set({ secrets: { ...draft.secrets, [f.key]: e.target.value } })} />
              {f.help && <p className="mt-1 text-xs text-zinc-500">{f.help}</p>}
            </FormField>
          );
        })}
      </div>
      <FormField label="Consent rule" htmlFor="consentPolicy" required>
        <select id="consentPolicy" className={textInputClass()} value={draft.consentPolicy} onChange={(e) => set({ consentPolicy: e.target.value as Draft["consentPolicy"] })}>
          <option value="OPT_OUT">{CONSENT_POLICIES.OPT_OUT}</option>
          <option value="OPT_IN">{CONSENT_POLICIES.OPT_IN}</option>
        </select>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Messages per minute" htmlFor="rate" required error={fe("ratePerMinute")}>
          <input id="rate" type="number" min={1} max={6000} className={textInputClass(!!fe("ratePerMinute"))} value={draft.ratePerMinute} onChange={(e) => set({ ratePerMinute: e.target.value })} />
        </FormField>
        <FormField label="Batch size" htmlFor="batch" required error={fe("batchSize")}>
          <input id="batch" type="number" min={1} max={500} className={textInputClass(!!fe("batchSize"))} value={draft.batchSize} onChange={(e) => set({ batchSize: e.target.value })} />
        </FormField>
      </div>
    </div>
  );
}

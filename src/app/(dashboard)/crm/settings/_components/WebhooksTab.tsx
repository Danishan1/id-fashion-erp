"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { LEAD_TARGET_FIELDS } from "@/modules/crm/ingestion/lead-field-catalog";
import { useLeadLookups } from "../../leads/_components/useLeadLookups";
import { CaptureDefaultsFields, CodeBlock, POLICY_LABELS, SecretOnce, type CaptureDefaults, type Policy } from "./CaptureShared";
import { useSettingsList } from "./useSettingsList";

interface WebhookRow {
  id: string;
  name: string;
  provider: string;
  path: string;
  fieldMapping: Record<string, string>;
  defaultSourceId: string | null;
  defaultOwnerUserId: string | null;
  duplicatePolicy: Policy;
  isActive: boolean;
  lastReceivedAt: string | null;
  createdBy: { fullName: string };
  defaultSource: { name: string } | null;
  defaultOwner: { fullName: string } | null;
}

const URL_BASE = "/api/v1/crm/settings/webhooks";
const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

function signingHelp(url: string, secret: string) {
  return `# Every request must be signed with the endpoint's secret:
#   X-CRM-Timestamp: <unix seconds>
#   X-CRM-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
#   X-CRM-Event-Id:  <optional unique id — repeats are ignored>

BODY='{"name":"Asha Rao","email":"asha@example.com","mobile":"+91 98765 43210","message":"5,000 polo shirts","id":"form-123"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac '${secret}' | sed 's/^.* //')
curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "X-CRM-Timestamp: $TS" \\
  -H "X-CRM-Signature: sha256=$SIG" \\
  -H "X-CRM-Event-Id: form-123" \\
  -d "$BODY"

# Send one lead object, or {"leads": [ ... ]} with up to 50.`;
}

function MappingEditor({ value, onChange }: { value: [string, string][]; onChange: (v: [string, string][]) => void }) {
  return (
    <div className="space-y-2">
      {value.map(([field, path], i) => (
        <div key={i} className="flex gap-2">
          <label htmlFor={`wm-f-${i}`} className="sr-only">
            CRM field
          </label>
          <select id={`wm-f-${i}`} className={textInputClass()} value={field} onChange={(e) => onChange(value.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}>
            <option value="">— Choose field —</option>
            {LEAD_TARGET_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <label htmlFor={`wm-p-${i}`} className="sr-only">
            JSON path
          </label>
          <input id={`wm-p-${i}`} className={`${textInputClass()} font-mono`} placeholder="e.g. contact.email" value={path} onChange={(e) => onChange(value.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <button type="button" aria-label="Remove" className="px-2 text-zinc-500 hover:text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange([...value, ["", ""]])}>
        + Add field
      </button>
    </div>
  );
}

function WebhookModal({ hook, onClose, onSaved }: { hook: WebhookRow | null; onClose: () => void; onSaved: (created?: { path: string; secret: string }) => void }) {
  const { meta, users } = useLeadLookups();
  const [name, setName] = useState(hook?.name ?? "");
  const [mapping, setMapping] = useState<[string, string][]>(Object.entries(hook?.fieldMapping ?? {}));
  const [defaults, setDefaults] = useState<CaptureDefaults>({ defaultSourceId: hook?.defaultSourceId ?? null, defaultOwnerUserId: hook?.defaultOwnerUserId ?? null, duplicatePolicy: hook?.duplicatePolicy ?? "UPDATE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fieldMapping = Object.fromEntries(mapping.filter(([f, p]) => f && p.trim()).map(([f, p]) => [f, p.trim()]));
    const res = hook
      ? await crmRequest(`${URL_BASE}/${hook.id}`, { method: "PATCH", body: { name, fieldMapping, ...defaults }, successMessage: "Webhook updated." })
      : await crmRequest<{ path: string; secret: string }>(URL_BASE, { method: "POST", body: { name, provider: "generic", fieldMapping, ...defaults }, toast: "errors" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onSaved(hook ? undefined : (res.data as { path: string; secret: string }));
  };
  return (
    <Modal open onClose={onClose} title={hook ? `Edit "${hook.name}"` : "Create webhook"} maxWidthClass="max-w-2xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="wh-name" required>
          <input id="wh-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus placeholder="e.g. Contact form via Zapier" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">{meta ? <CaptureDefaultsFields value={defaults} onChange={setDefaults} sources={meta.sources} users={users} idPrefix="wh" /> : <CrmLoadingState />}</div>
        <div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Field mapping (optional)</p>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">Leave empty to match JSON keys automatically by name (name, email, mobile, company, message…). Add rows when the payload uses other keys or nesting.</p>
          <MappingEditor value={mapping} onChange={setMapping} />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            {hook ? "Save" : "Create webhook"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WebhooksTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<WebhookRow>(URL_BASE);
  const [editing, setEditing] = useState<WebhookRow | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null);
  const [rotating, setRotating] = useState<WebhookRow | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;
  const toggle = async (w: WebhookRow) => {
    const res = await crmRequest(`${URL_BASE}/${w.id}`, { method: "PATCH", body: { isActive: !w.isActive }, successMessage: w.isActive ? "Webhook paused." : "Webhook active." });
    if (res.ok) reload();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Signed webhooks let website forms, Zapier, Make, Pabbly or any system post leads to a private URL. Meta, IndiaMART and other connectors will appear here as they are added.
        </p>
        {canEdit && <Button onClick={() => setEditing("new")}>Create webhook</Button>}
      </div>
      {revealed && (
        <div className="space-y-3">
          <SecretOnce label="Signing secret" value={revealed.secret} />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            URL: <code className="break-all text-xs">{revealed.url}</code>
          </p>
          <CodeBlock>{signingHelp(revealed.url, revealed.secret)}</CodeBlock>
          <Button variant="secondary" onClick={() => setRevealed(null)}>
            I&apos;ve saved the secret
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <CrmEmptyState title="No webhooks yet" description="Create one per form or system so each has its own URL, secret and defaults." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">URL</th>
                <th className="px-3 py-2">New leads</th>
                <th className="px-3 py-2">Last delivery</th>
                <th className="px-3 py-2">Active</th>
                {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((w) => (
                <tr key={w.id} className={w.isActive ? "" : "opacity-60"}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{w.name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {w.provider === "generic" ? "Generic signed webhook" : w.provider} · {Object.keys(w.fieldMapping).length ? `${Object.keys(w.fieldMapping).length} mapped field(s)` : "automatic mapping"}
                    </span>
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    <code className="block truncate text-xs" title={`${origin()}${w.path}`}>
                      {origin()}
                      {w.path}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                    {w.defaultSource?.name ?? "Website"} · {w.defaultOwner?.fullName ?? "Unassigned"}
                    <span className="block">{POLICY_LABELS[w.duplicatePolicy]}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{w.lastReceivedAt ? <ClientDateTime value={w.lastReceivedAt} /> : "Never"}</td>
                  <td className="px-3 py-2">
                    <ToggleSwitch checked={w.isActive} disabled={!canEdit} label={`${w.name} active`} onToggle={() => toggle(w)} />
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing(w)}>
                        Edit
                      </button>
                      <button type="button" className="ml-3 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setRotating(w)}>
                        New secret
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <WebhookModal
          hook={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            if (c) setRevealed({ url: `${origin()}${c.path}`, secret: c.secret });
            reload();
          }}
        />
      )}
      <ConfirmModal
        open={Boolean(rotating)}
        title={`New secret for "${rotating?.name ?? ""}"?`}
        message="The current secret stops working immediately. Update the sending system with the new one."
        confirmLabel="Create new secret"
        isBusy={busy}
        onConfirm={async () => {
          if (!rotating) return;
          setBusy(true);
          const res = await crmRequest<{ path: string; secret: string }>(`${URL_BASE}/${rotating.id}/rotate-secret`, { method: "POST", toast: "errors" });
          setBusy(false);
          setRotating(null);
          if (res.ok) setRevealed({ url: `${origin()}${res.data.path}`, secret: res.data.secret });
        }}
        onCancel={() => setRotating(null)}
      />
    </div>
  );
}

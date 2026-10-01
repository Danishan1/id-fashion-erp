"use client";

import { useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { useLeadLookups } from "../../leads/_components/useLeadLookups";
import { CaptureDefaultsFields, CodeBlock, POLICY_LABELS, SecretOnce, type CaptureDefaults, type Policy } from "./CaptureShared";
import { useSettingsList } from "./useSettingsList";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  defaultSourceId: string | null;
  defaultOwnerUserId: string | null;
  duplicatePolicy: Policy;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { fullName: string };
  defaultSource: { name: string } | null;
  defaultOwner: { fullName: string } | null;
}

const URL_BASE = "/api/v1/crm/settings/api-keys";

function exampleRequest(key: string) {
  const origin = typeof window === "undefined" ? "https://your-erp.example.com" : window.location.origin;
  return `curl -X POST ${origin}/api/v1/crm/leads/ingest \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: form-submission-123" \\
  -d '{
    "channel": "WEBSITE_FORM",
    "name": "Asha Rao",
    "email": "asha@example.com",
    "mobile": "+91 98765 43210",
    "companyName": "Rao Exports",
    "requirement": "5,000 polo shirts",
    "utmSource": "google",
    "externalLeadId": "web-123"
  }'`;
}

function KeyModal({ keyRow, onClose, onSaved }: { keyRow: ApiKeyRow | null; onClose: () => void; onSaved: (created?: { key: string }) => void }) {
  const { meta, users } = useLeadLookups();
  const [name, setName] = useState(keyRow?.name ?? "");
  const [expiresAt, setExpiresAt] = useState("");
  const [defaults, setDefaults] = useState<CaptureDefaults>({ defaultSourceId: keyRow?.defaultSourceId ?? null, defaultOwnerUserId: keyRow?.defaultOwnerUserId ?? null, duplicatePolicy: keyRow?.duplicatePolicy ?? "UPDATE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = keyRow
      ? await crmRequest(`${URL_BASE}/${keyRow.id}`, { method: "PATCH", body: { name, ...defaults }, successMessage: "API key updated." })
      : await crmRequest<{ key: string }>(URL_BASE, { method: "POST", body: { name, ...defaults, expiresAt: expiresAt || null }, toast: "errors" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onSaved(keyRow ? undefined : (res.data as { key: string }));
  };
  return (
    <Modal open onClose={onClose} title={keyRow ? `Edit "${keyRow.name}"` : "Create API key"} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="key-name" required>
          <input id="key-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus placeholder="e.g. Company website" />
        </FormField>
        {meta ? <CaptureDefaultsFields value={defaults} onChange={setDefaults} sources={meta.sources} users={users} idPrefix="key" /> : <CrmLoadingState />}
        {!keyRow && (
          <FormField label="Expires on (optional)" htmlFor="key-expiry">
            <input id="key-expiry" type="date" className={textInputClass()} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </FormField>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            {keyRow ? "Save" : "Create key"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function status(k: ApiKeyRow) {
  if (k.revokedAt) return <CrmBadge label="Revoked" tone="neutral" />;
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return <CrmBadge label="Expired" tone="amber" />;
  return <CrmBadge label="Active" tone="green" />;
}

export function ApiKeysTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<ApiKeyRow>(URL_BASE);
  const [editing, setEditing] = useState<ApiKeyRow | "new" | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Websites and other systems send leads to <code className="text-xs">POST /api/v1/crm/leads/ingest</code> with one of these keys. Every lead goes through the same validation and duplicate rules as imports.
        </p>
        {canEdit && <Button onClick={() => setEditing("new")}>Create API key</Button>}
      </div>
      {created && (
        <div className="space-y-3">
          <SecretOnce label="Your new API key" value={created} />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Example request:</p>
          <CodeBlock>{exampleRequest(created)}</CodeBlock>
          <Button variant="secondary" onClick={() => setCreated(null)}>
            I&apos;ve saved the key
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <CrmEmptyState title="No API keys yet" description="Create a key for each website or system that should send leads, so you can revoke one without affecting the others." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">New leads</th>
                <th className="px-3 py-2">Last used</th>
                <th className="px-3 py-2">Status</th>
                {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((k) => (
                <tr key={k.id} className={k.revokedAt ? "opacity-60" : ""}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{k.name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      by {k.createdBy.fullName} · <ClientDateTime value={k.createdAt} mode="date" />
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-300">crmk_{k.prefix}_••••</td>
                  <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                    {k.defaultSource?.name ?? "Website / API"} · {k.defaultOwner?.fullName ?? "Unassigned"}
                    <span className="block">{POLICY_LABELS[k.duplicatePolicy]}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{k.lastUsedAt ? <ClientDateTime value={k.lastUsedAt} /> : "Never"}</td>
                  <td className="px-3 py-2">{status(k)}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {!k.revokedAt && (
                        <>
                          <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing(k)}>
                            Edit
                          </button>
                          <button type="button" className="ml-3 text-xs font-medium text-red-600 hover:underline dark:text-red-400" onClick={() => setRevoking(k)}>
                            Revoke
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <KeyModal
          keyRow={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null);
            if (c) setCreated(c.key);
            reload();
          }}
        />
      )}
      <ConfirmModal
        open={Boolean(revoking)}
        title={`Revoke "${revoking?.name ?? ""}"?`}
        message="Requests using this key will be rejected immediately. This can't be undone — create a new key if you need one again."
        confirmLabel="Revoke key"
        isDangerous
        isBusy={busy}
        onConfirm={async () => {
          if (!revoking) return;
          setBusy(true);
          await crmRequest(`${URL_BASE}/${revoking.id}`, { method: "DELETE", successMessage: "API key revoked." });
          setBusy(false);
          setRevoking(null);
          reload();
        }}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

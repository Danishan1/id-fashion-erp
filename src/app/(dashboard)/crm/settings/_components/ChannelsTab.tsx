"use client";

import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CHANNEL_SETTINGS_API } from "@/components/crm/conversations/conversation-types";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { CHANNEL_TYPE_LABELS } from "@/modules/crm/conversations/conversation-registry";
import { CodeBlock, SecretOnce } from "./CaptureShared";
import { useSettingsList } from "./useSettingsList";

interface ChannelRow {
  id: string;
  channelType: string;
  typeLabel: string;
  name: string;
  provider: string;
  providerLabel: string;
  status: "ACTIVE" | "PAUSED";
  address: string | null;
  config: { outboundUrl?: string | null; allowAttachments?: boolean; maxAttachmentMb?: number };
  defaultAssignee: { id: string; fullName: string } | null;
  lastInboundAt: string | null;
  version: number;
  path: string;
  capabilities: { canSend: boolean };
}

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

function signingHelp(url: string, secret: string) {
  return `# Every request must be signed with the channel's secret:
#   X-CRM-Timestamp: <unix seconds>   (older than 5 minutes is rejected)
#   X-CRM-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
# The message "id" must be unique — repeats are acknowledged and ignored.

BODY='{"type":"message","id":"msg-1001","from":{"phone":"+91 98765 43210","name":"Asha Rao"},"text":"Hi, can you share the catalogue?"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac '${secret}' | sed 's/^.* //')
curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "X-CRM-Timestamp: $TS" \\
  -H "X-CRM-Signature: sha256=$SIG" \\
  -d "$BODY"

# from: email | phone | id (provider user id) | sessionId (anonymous chat) | name
# Batches: {"events":[ ... ]} (up to 50). Delivery receipts:
#   {"type":"status","messageId":"<id your outbound endpoint returned>","status":"delivered"}`;
}

function ChannelModal({ channel, onClose, onSaved }: { channel: ChannelRow | null; onClose: () => void; onSaved: (created?: { path: string; secret: string }) => void }) {
  const [channelType, setChannelType] = useState(channel?.channelType ?? "WHATSAPP");
  const [name, setName] = useState(channel?.name ?? "");
  const [address, setAddress] = useState(channel?.address ?? "");
  const [assignee, setAssignee] = useState(channel?.defaultAssignee?.id ?? "");
  const [outboundUrl, setOutboundUrl] = useState(channel?.config.outboundUrl ?? "");
  const [allowAttachments, setAllowAttachments] = useState(channel?.config.allowAttachments ?? true);
  const [maxMb, setMaxMb] = useState(String(channel?.config.maxAttachmentMb ?? 5));
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((u) => setUsers((u.data ?? []).filter((x: { status?: string }) => !x.status || x.status === "ACTIVE")))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const config = { outboundUrl: outboundUrl.trim() || null, allowAttachments, maxAttachmentMb: Number(maxMb) || 5 };
    const res = channel
      ? await crmRequest(`${CHANNEL_SETTINGS_API}/${channel.id}`, { method: "PATCH", body: { version: channel.version, name, address, defaultAssigneeUserId: assignee || null, config }, toast: "off" })
      : await crmRequest<{ path: string; secret: string }>(CHANNEL_SETTINGS_API, { method: "POST", body: { channelType, name, address, defaultAssigneeUserId: assignee || null, provider: "generic", config }, toast: "off" });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    onSaved(channel ? undefined : (res.data as { path: string; secret: string }));
  };

  return (
    <Modal open onClose={onClose} title={channel ? `Edit "${channel.name}"` : "Add channel"} maxWidthClass="max-w-2xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Channel type" htmlFor="chn-type" required>
            <select id="chn-type" className={textInputClass()} value={channelType} onChange={(e) => setChannelType(e.target.value)} disabled={Boolean(channel)}>
              {Object.entries(CHANNEL_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Name" htmlFor="chn-name" required error={errors.name}>
            <input id="chn-name" className={textInputClass(Boolean(errors.name))} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. Sales WhatsApp" />
          </FormField>
          <FormField label="Business address / number" htmlFor="chn-address">
            <input id="chn-address" className={textInputClass()} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="e.g. +91 80000 00000 or sales@company.com" />
          </FormField>
          <FormField label="New conversations go to" htmlFor="chn-assignee" error={errors.defaultAssigneeUserId}>
            <SearchableSelect id="chn-assignee" value={assignee} onChange={setAssignee} options={users.map((u) => ({ id: u.id, label: u.fullName }))} emptyOptionLabel="— Unassigned (managers triage) —" placeholder="Search people…" />
          </FormField>
        </div>
        <fieldset className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Replies (optional)</legend>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Leave empty for a receive-only channel. With a URL, replies from the inbox are POSTed there, signed with the same secret, for your relay or provider bridge to deliver.</p>
          <FormField label="Outbound URL" htmlFor="chn-url" error={errors.outboundUrl}>
            <input id="chn-url" type="url" className={`${textInputClass(Boolean(errors.outboundUrl))} font-mono`} value={outboundUrl} onChange={(e) => setOutboundUrl(e.target.value)} placeholder="https://relay.example.com/crm/outbound" />
          </FormField>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allowAttachments} onChange={(e) => setAllowAttachments(e.target.checked)} /> Allow attachments (images, PDF, Office files)
            </label>
            <label className="flex items-center gap-2 text-sm">
              Max size
              <select aria-label="Maximum attachment size" className={`${textInputClass()} w-24`} value={maxMb} onChange={(e) => setMaxMb(e.target.value)} disabled={!allowAttachments}>
                {[1, 2, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} MB
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            {channel ? "Save" : "Add channel"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Conversation channels (Phase 11). Each channel has its own webhook URL and
 * signing secret; the provider adapter ("Generic signed webhook" for now)
 * turns deliveries into inbox messages. WhatsApp Business, email, SMS and
 * Meta connectors are added as providers later — same screen, same inbox.
 */
export function ChannelsTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<ChannelRow>(CHANNEL_SETTINGS_API);
  const [editing, setEditing] = useState<ChannelRow | "new" | null>(null);
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null);
  const [rotating, setRotating] = useState<ChannelRow | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;
  const toggle = async (c: ChannelRow) => {
    const res = await crmRequest(`${CHANNEL_SETTINGS_API}/${c.id}`, { method: "PATCH", body: { version: c.version, status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }, successMessage: c.status === "ACTIVE" ? "Channel paused." : "Channel active." });
    if (res.ok) reload();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Channels feed the unified Inbox. Each one gets a private, signed webhook URL; messages are matched to contacts by email or phone, and anything unknown waits in the Unmatched queue. A paused channel neither sends nor accepts messages (senders retry later).
        </p>
        {canEdit && <Button onClick={() => setEditing("new")}>Add channel</Button>}
      </div>
      {revealed && (
        <div className="space-y-3">
          <SecretOnce label="Signing secret" value={revealed.secret} />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Webhook URL: <code className="break-all text-xs">{revealed.url}</code>
          </p>
          <CodeBlock>{signingHelp(revealed.url, revealed.secret)}</CodeBlock>
          <Button variant="secondary" onClick={() => setRevealed(null)}>
            I&apos;ve saved the secret
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <CrmEmptyState title="No channels yet" description="Add one per number, mailbox, page or website chat." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Webhook URL</th>
                <th className="px-3 py-2">Replies</th>
                <th className="px-3 py-2">New conversations</th>
                <th className="px-3 py-2">Last message</th>
                <th className="px-3 py-2">Active</th>
                {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((c) => (
                <tr key={c.id} className={c.status === "ACTIVE" ? "" : "opacity-60"}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {c.typeLabel} · {c.providerLabel}
                      {c.address ? ` · ${c.address}` : ""}
                    </span>
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    <code className="block truncate text-xs" title={`${origin()}${c.path}`}>
                      {origin()}
                      {c.path}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-xs">{c.config.outboundUrl ? "Enabled" : "Receive only"}</td>
                  <td className="px-3 py-2 text-xs">{c.defaultAssignee?.fullName ?? "Unassigned"}</td>
                  <td className="px-3 py-2 text-xs">{c.lastInboundAt ? <ClientDateTime value={c.lastInboundAt} /> : "Never"}</td>
                  <td className="px-3 py-2">
                    <ToggleSwitch checked={c.status === "ACTIVE"} disabled={!canEdit} label={`${c.name} active`} onToggle={() => toggle(c)} />
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing(c)}>
                        Edit
                      </button>
                      <button type="button" className="ml-3 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setRotating(c)}>
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
        <ChannelModal
          channel={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            if (created) setRevealed({ url: `${origin()}${created.path}`, secret: created.secret });
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
          const res = await crmRequest<{ path: string; secret: string }>(`${CHANNEL_SETTINGS_API}/${rotating.id}/rotate-secret`, { method: "POST", toast: "errors" });
          setBusy(false);
          setRotating(null);
          if (res.ok) setRevealed({ url: `${origin()}${res.data.path}`, secret: res.data.secret });
        }}
        onCancel={() => setRotating(null)}
      />
    </div>
  );
}

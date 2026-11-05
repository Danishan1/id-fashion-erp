"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { getApiErrorMessage } from "@/lib/api-client";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CARD, CHANNEL_LABELS, NotLiveVerifiedBadge, RunStatusBadge, fmtCount, fmtDateTime, newIdempotencyKey, send, skipReasonLabel, useApi } from "./delivery-ui";

interface ChannelRow {
  id: string;
  isActive: boolean;
  channelType: string;
  connection: { id: string; code: string; name: string; providerLabel: string; status: string; consentPolicy: string; liveVerified: boolean; lastTestStatus: string | null };
  template: { id: string; name: string; status: string; versionNumber: number | null };
  content: { id: string; name: string; status: string; versionNumber: number | null } | null;
  sends: { source: string; label: string; attachments: string[]; locale: string | null } | null;
  problems: string[];
  runs: { id: string; runNumber: number; status: string; scheduledFor: string | null; createdAt: string; finishedAt: string | null; plannedCount: number }[];
}
interface ChannelsData {
  campaign: { id: string; code: string; status: string };
  channels: ChannelRow[];
}
interface Options {
  connections: { id: string; code: string; name: string; channelType: string; providerLabel: string; liveVerified: boolean }[];
  templates: { id: string; name: string; channelType: string }[];
}
interface Eligibility {
  computedAt: string;
  audience: number;
  removedByExclusions: number;
  eligible: number;
  skipped: Record<string, number>;
  consentPolicy: string;
}

const OPEN = ["PREPARING", "SCHEDULED", "QUEUED", "RUNNING"];

/**
 * Campaign → Channels & Delivery (Phase 10). Nothing is sent until someone
 * with the send permission checks the recipients and presses Send / Schedule
 * on an ACTIVE campaign. Consent is checked again just before each message.
 */
export function CampaignDeliveryPanel({ campaignId, canCreate, canEdit }: { campaignId: string; canCreate: boolean; canEdit: boolean }) {
  const { data, error, reload } = useApi<ChannelsData>(`/api/v1/sales-marketing/campaigns/${campaignId}/channels`);
  const [adding, setAdding] = useState(false);

  if (error) return <div className={`${CARD} mt-4`}><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <div className={`${CARD} mt-4`}><LoadingState /></div>;
  const closed = ["COMPLETED", "CANCELLED"].includes(data.campaign.status);
  const active = data.campaign.status === "ACTIVE";

  return (
    <section className={`${CARD} mt-4 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Channels &amp; delivery</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Send this campaign&apos;s message to its audience by email, SMS or WhatsApp. Only CRM-contact audiences can be sent to. {active ? "" : "Sending is possible once the campaign is active."}
          </p>
        </div>
        {canCreate && !closed && !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add channel
          </Button>
        )}
      </div>
      {adding && <AddChannel campaignId={campaignId} onDone={() => (setAdding(false), reload())} onCancel={() => setAdding(false)} />}
      {data.channels.length === 0 && !adding && <p className="text-sm text-zinc-500">No channels set up.</p>}
      {data.channels.map((ch) => (
        <ChannelCard key={ch.id} ch={ch} campaignActive={active} closed={closed} canCreate={canCreate} canEdit={canEdit} reload={reload} />
      ))}
    </section>
  );
}

function AddChannel({ campaignId, onDone, onCancel }: { campaignId: string; onDone: () => void; onCancel: () => void }) {
  const { data, error } = useApi<Options>("/api/v1/sales-marketing/delivery/options");
  // Campaign content (Phase 11) — only listed for users who can see the content library.
  const { data: contents } = useApi<{ contents: { id: string; name: string; channelType: string; status: string; approvedVersionNumber: number | null }[] }>(`/api/v1/sales-marketing/campaigns/${campaignId}/contents`);
  const [connectionId, setConnectionId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [contentId, setContentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <p className="text-sm text-red-700 dark:text-red-400">{error}</p>;
  if (!data) return <LoadingState />;
  const conn = data.connections.find((c) => c.id === connectionId);
  const templates = conn ? data.templates.filter((t) => t.channelType === conn.channelType) : [];
  const ownContents = conn ? (contents?.contents ?? []).filter((c) => c.channelType === conn.channelType && c.status === "ACTIVE") : [];
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await send(`/api/v1/sales-marketing/campaigns/${campaignId}/channels`, "POST", contentId ? { connectionId, contentId } : { connectionId, templateId });
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      {data.connections.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No active connections. Set one up in <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href="/sales-marketing/delivery/connections">Channel Connections</Link> first.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Connection</span>
            <select className={`${textInputClass()} !w-auto min-w-[14rem]`} value={connectionId} onChange={(e) => (setConnectionId(e.target.value), setTemplateId(""), setContentId(""))}>
              <option value="">Choose…</option>
              {data.connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({CHANNEL_LABELS[c.channelType] ?? c.channelType} · {c.providerLabel})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Message</span>
            <select
              className={`${textInputClass()} !w-auto min-w-[14rem]`}
              value={contentId ? `c:${contentId}` : templateId ? `t:${templateId}` : ""}
              disabled={!conn}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(":");
                setContentId(kind === "c" ? id : "");
                setTemplateId(kind === "t" ? id : "");
              }}
            >
              <option value="">{conn ? (templates.length + ownContents.length ? "Choose…" : "No active templates or content for this channel") : "Pick a connection first"}</option>
              {ownContents.length > 0 && (
                <optgroup label="This campaign's content">
                  {ownContents.map((c) => (
                    <option key={c.id} value={`c:${c.id}`}>
                      {c.name}
                      {c.approvedVersionNumber ? ` (v${c.approvedVersionNumber} approved)` : " (not approved yet)"}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Templates as they are">
                {templates.map((t) => (
                  <option key={t.id} value={`t:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <Button size="sm" disabled={!connectionId || (!templateId && !contentId) || busy} onClick={save}>
            {busy ? "Adding…" : "Add"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{msg}</p>}
    </div>
  );
}

function ChannelCard({ ch, campaignActive, closed, canCreate, canEdit, reload }: { ch: ChannelRow; campaignActive: boolean; closed: boolean; canCreate: boolean; canEdit: boolean; reload: () => void }) {
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [testTo, setTestTo] = useState("");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [when, setWhen] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const openRun = ch.runs.find((r) => OPEN.includes(r.status));
  const sendable = campaignActive && ch.isActive && ch.problems.length === 0 && !openRun;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: (r: unknown) => string) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      if (ok) setMsg({ ok: true, text: ok(r) });
      return r;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const check = () =>
    run("check", async () => {
      const r = await fetch(`/api/v1/sales-marketing/delivery/channels/${ch.id}/eligibility`, { headers: { "x-toast": "off" } });
      if (!r.ok) throw new Error(await getApiErrorMessage(r));
      setEligibility((await r.json()).data as Eligibility);
    });

  const start = () =>
    run(
      "start",
      async () => {
        const body: Record<string, unknown> = { confirmed: true, idempotencyKey: idemKey };
        if (mode === "schedule") body.scheduledFor = new Date(when).toISOString();
        const r = await send<{ runNumber: number; mode: string | null }>(`/api/v1/sales-marketing/delivery/channels/${ch.id}/runs`, "POST", body);
        setEligibility(null);
        setConfirmed(false);
        setIdemKey(newIdempotencyKey());
        reload();
        return r;
      },
      (r) => {
        const x = r as { runNumber: number; mode: string | null };
        return mode === "schedule" ? `Run #${x.runNumber} scheduled.` : `Run #${x.runNumber} started.${x.mode === "inline" ? " No background worker is configured, so it's sending from the web server — scheduled sends and retries need the worker." : ""}`;
      }
    );

  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{CHANNEL_LABELS[ch.channelType] ?? ch.channelType}</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              via {ch.connection.name} ({ch.connection.providerLabel})
            </span>
            <NotLiveVerifiedBadge liveVerified={ch.connection.liveVerified} />
            {!ch.isActive && <span className="text-xs text-zinc-500">· disabled</span>}
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {ch.content ? (
              <>
                Content:{" "}
                <Link className="underline" href={`/sales-marketing/content/items/${ch.content.id}`}>
                  {ch.content.name}
                </Link>
              </>
            ) : (
              <>
                Template:{" "}
                <Link className="underline" href={`/sales-marketing/content/templates/${ch.template.id}`}>
                  {ch.template.name}
                </Link>
              </>
            )}
            {ch.sends ? ` — sends ${ch.sends.label}${ch.sends.attachments.length ? ` with ${ch.sends.attachments.join(", ")}` : ""}; a run keeps the version it starts with` : ""}
          </div>
        </div>
        {canEdit && !closed && (
          <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => run("toggle", () => send(`/api/v1/sales-marketing/delivery/channels/${ch.id}`, "PATCH", { isActive: !ch.isActive }).then(reload))}>
            {ch.isActive ? "Disable" : "Enable"}
          </Button>
        )}
      </div>

      {ch.problems.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
          {ch.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {canCreate && !closed && ch.isActive && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${textInputClass()} !w-64`} placeholder={ch.channelType === "EMAIL" ? "you@company.com" : "+91 98xxxxxxxx"} value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test recipient" />
            <Button size="xs" variant="secondary" disabled={!testTo || !!busy || ch.problems.length > 0} onClick={() => run("test", () => send<{ ok: boolean; message: string }>(`/api/v1/sales-marketing/delivery/channels/${ch.id}/test-send`, "POST", { to: testTo }), (r) => (r as { message: string }).message)}>
              {busy === "test" ? "Sending…" : "Send test"}
            </Button>
            <span className="text-xs text-zinc-500">Sample data, marked [TEST]. Not counted.</span>
          </div>

          {openRun ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Run #{openRun.runNumber} is {openRun.status.toLowerCase()} — <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/sales-marketing/delivery/runs/${openRun.id}`}>open it</Link>.
            </p>
          ) : !campaignActive ? null : !eligibility ? (
            <Button size="sm" disabled={!!busy || ch.problems.length > 0} onClick={check}>
              {busy === "check" ? "Checking…" : "Check recipients"}
            </Button>
          ) : (
            <div className="rounded bg-zinc-50 p-3 text-sm dark:bg-zinc-950">
              <div>
                <strong>{fmtCount(eligibility.eligible)}</strong> of {fmtCount(eligibility.audience)} contacts would get this message now
                {eligibility.removedByExclusions ? ` (${fmtCount(eligibility.removedByExclusions)} removed by exclusion segments)` : ""}.
              </div>
              {Object.keys(eligibility.skipped).length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                  {Object.entries(eligibility.skipped).map(([k, n]) => (
                    <li key={k}>
                      {fmtCount(n)} — {skipReasonLabel(k)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-zinc-500">Checked {fmtDateTime(eligibility.computedAt)}. Consent and addresses are checked again just before each message.</p>
              {sendable && eligibility.eligible > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1">
                      <input type="radio" checked={mode === "now"} onChange={() => setMode("now")} /> Send now
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" checked={mode === "schedule"} onChange={() => setMode("schedule")} /> Schedule
                    </label>
                    {mode === "schedule" && <input type="datetime-local" className={`${textInputClass()} !w-auto`} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Send at" />}
                  </div>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
                    <span>
                      I confirm sending to about {fmtCount(eligibility.eligible)} contacts. Messages handed to the provider can&apos;t be recalled.
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!confirmed || !!busy || (mode === "schedule" && !when)} onClick={start}>
                      {busy === "start" ? "Starting…" : mode === "schedule" ? "Schedule" : "Send"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => (setEligibility(null), setConfirmed(false))}>
                      Close
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}

      {ch.runs.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1">Run</th>
              <th>Status</th>
              <th>Recipients</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {ch.runs.slice(0, 5).map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1">
                  <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/sales-marketing/delivery/runs/${r.id}`}>
                    #{r.runNumber}
                  </Link>
                </td>
                <td>
                  <RunStatusBadge status={r.status} />
                </td>
                <td>{fmtCount(r.plannedCount)}</td>
                <td>{fmtDateTime(r.finishedAt ?? r.scheduledFor ?? r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

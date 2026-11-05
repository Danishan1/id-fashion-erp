"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { EventList, type PerformanceEvent } from "../performance/performance-ui";
import { send } from "../commissions/commission-ui";

export interface ChannelAgentView {
  salesChannelId: string | null;
  salesChannel: string | null;
  salesAgentId: string | null;
  salesAgent: string | null;
  history: PerformanceEvent[];
}

interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

const HELP = {
  ENQUIRY: "Where this enquiry came from. A quotation made from it starts with the same channel and agent.",
  QUOTATION: "What this quotation is made under. A Sales Order converted from it starts with the same channel and agent.",
  SALES_ORDER: "What this sale is credited to: channel reports and sales-agent commission read the order's channel and agent.",
} as const;

/**
 * Channel & sales agent on an enquiry, quotation or Sales Order (Phase 07).
 * `apiUrl` is the document's channel endpoint; on an order a reason is required.
 */
export function ChannelAgentPanel({ apiUrl, docType, canChange }: { apiUrl: string; docType: keyof typeof HELP; canChange: boolean }) {
  const [c, setC] = useState<ChannelAgentView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({ salesChannelId: "", salesAgentId: "", reason: "" });
  const [channels, setChannels] = useState<Option[]>([]);
  const [agents, setAgents] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl, { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => setC(b.data))
      .catch(() => setLoadError(true));
  }, [apiUrl]);

  useEffect(() => {
    if (!editing) return;
    fetch("/api/v1/sales-marketing/channels/options", { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : { data: { channels: [], agents: [] } }))
      .then((b) => {
        setChannels((b.data.channels ?? []).map((x: { id: string; name: string; code: string }) => ({ id: x.id, label: x.name, sublabel: x.code })));
        setAgents((b.data.agents ?? []).map((x: { id: string; name: string; code: string }) => ({ id: x.id, label: x.name, sublabel: x.code })));
      })
      .catch(() => undefined);
  }, [editing]);

  if (loadError) return null;
  if (!c) return null;
  // Keep a current (possibly inactive) value selectable.
  const withCurrent = (opts: Option[], id: string | null, label: string | null) => (id && !opts.some((o) => o.id === id) ? [{ id, label: label ?? "Current" }, ...opts] : opts);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby={`chan-${docType}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`chan-${docType}`} className="font-semibold text-zinc-900 dark:text-zinc-50">
          Channel &amp; sales agent
        </h2>
        <div className="flex gap-2">
          {c.history.length > 0 && (
            <Button size="xs" variant="secondary" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide changes" : `Changes (${c.history.length})`}
            </Button>
          )}
          {canChange && (
            <Button size="xs" variant="secondary" onClick={() => (setError(null), setForm({ salesChannelId: c.salesChannelId ?? "", salesAgentId: c.salesAgentId ?? "", reason: "" }), setEditing(true))}>
              Change
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1">
        Channel: <strong>{c.salesChannel ?? "None"}</strong> · Sales agent: <strong>{c.salesAgent ?? "None"}</strong>
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{HELP[docType]}</p>
      {showHistory && (
        <div className="mt-3">
          <EventList events={c.history} />
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(false)} title="Change channel & sales agent">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                setC(await send<ChannelAgentView>(apiUrl, "PATCH", docType === "SALES_ORDER" ? form : { salesChannelId: form.salesChannelId, salesAgentId: form.salesAgentId }));
                setEditing(false);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FormField label="Channel" htmlFor={`ch-${docType}`}>
              <SearchableSelect id={`ch-${docType}`} value={form.salesChannelId} onChange={(salesChannelId) => setForm({ ...form, salesChannelId })} options={withCurrent(channels, c.salesChannelId, c.salesChannel)} placeholder="Search channels…" emptyOptionLabel="— No channel —" />
            </FormField>
            <FormField label="Sales agent" htmlFor={`ag-${docType}`}>
              <SearchableSelect id={`ag-${docType}`} value={form.salesAgentId} onChange={(salesAgentId) => setForm({ ...form, salesAgentId })} options={withCurrent(agents, c.salesAgentId, c.salesAgent)} placeholder="Search sales agents…" emptyOptionLabel="— No sales agent —" />
            </FormField>
            {docType === "SALES_ORDER" && (
              <FormField label="Reason" htmlFor="ch-reason" required>
                <textarea id="ch-reason" rows={2} required minLength={3} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={textInputClass()} />
              </FormField>
            )}
            {docType === "SALES_ORDER" && <p className="text-xs text-zinc-500">Commission already in a submitted or approved statement stays with whoever earned it.</p>}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

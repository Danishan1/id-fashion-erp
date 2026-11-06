"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { EventList, type PerformanceEvent } from "../performance/performance-ui";
import { send } from "../commissions/commission-ui";

interface View {
  campaignId: string | null;
  campaign: string | null;
  history: PerformanceEvent[];
}

const HELP = {
  lead: "The marketing campaign this lead came from.",
  enquiry: "The campaign this enquiry came from. A quotation made from it starts with the same campaign.",
  quotation: "The campaign this quotation belongs to. A Sales Order converted from it starts with the same campaign.",
  order: "The campaign this sale counts for in campaign results.",
} as const;

/** Campaign on a CRM lead, enquiry, quotation or Sales Order (Phase 08). Loads itself; hidden without access. */
export function CampaignLinkPanel({ docType, id, canChange }: { docType: keyof typeof HELP; id: string; canChange: boolean }) {
  const url = `/api/v1/sales-marketing/campaign-links/${docType}/${id}`;
  const [v, setV] = useState<View | null>(null);
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [options, setOptions] = useState<{ id: string; label: string; sublabel?: string }[]>([]);
  const [form, setForm] = useState({ campaignId: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(url, { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => setV(b.data))
      .catch(() => setHidden(true));
  }, [url]);
  useEffect(() => {
    if (!editing) return;
    fetch("/api/v1/sales-marketing/campaigns/options", { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setOptions((b.data ?? []).map((c: { id: string; code: string; name: string; status: string }) => ({ id: c.id, label: c.name, sublabel: `${c.code} · ${c.status.toLowerCase()}` }))))
      .catch(() => undefined);
  }, [editing]);

  if (hidden || !v) return null;
  const opts = v.campaignId && !options.some((o) => o.id === v.campaignId) ? [{ id: v.campaignId, label: v.campaign ?? "Current" }, ...options] : options;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" aria-label="Campaign">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Campaign</h2>
        <div className="flex gap-2">
          {v.history.length > 0 && (
            <Button size="xs" variant="secondary" onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? "Hide changes" : `Changes (${v.history.length})`}
            </Button>
          )}
          {canChange && (
            <Button size="xs" variant="secondary" onClick={() => (setError(null), setForm({ campaignId: v.campaignId ?? "", reason: "" }), setEditing(true))}>
              Change
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1">
        {v.campaignId ? (
          <Link href={`/sales-marketing/campaigns/${v.campaignId}`} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
            {v.campaign}
          </Link>
        ) : (
          <strong>None</strong>
        )}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{HELP[docType]}</p>
      {showHistory && (
        <div className="mt-3">
          <EventList events={v.history} />
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(false)} title="Change campaign">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                setV(await send<View>(url, "PATCH", docType === "order" ? form : { campaignId: form.campaignId }));
                setEditing(false);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FormField label="Campaign" htmlFor={`cmp-${docType}`}>
              <SearchableSelect id={`cmp-${docType}`} value={form.campaignId} onChange={(campaignId) => setForm({ ...form, campaignId })} options={opts} placeholder="Search approved / running campaigns…" emptyOptionLabel="— No campaign —" />
            </FormField>
            {docType === "order" && (
              <FormField label="Reason" htmlFor="cmp-reason" required>
                <textarea id="cmp-reason" rows={2} required minLength={3} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={textInputClass()} />
              </FormField>
            )}
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

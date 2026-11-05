"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-format";
import { EventList, usePerformanceOptions, type PerformanceEvent } from "./performance-ui";

export interface SalesCreditView {
  salesRepUserId: string | null;
  salesRep: string | null;
  salesTerritoryId: string | null;
  salesTerritory: string | null;
  source: string | null;
  sourceLabel: string | null;
  changedAt: string | null;
  changedBy: string | null;
  reason: string | null;
  history: PerformanceEvent[];
}

/** Sales credit on the Sales Order page (Phase 05): who and which territory this order counts for. */
export function SalesCreditPanel({ orderId, initial, canChange }: { orderId: string; initial: SalesCreditView; canChange: boolean }) {
  const [c, setC] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [form, setForm] = useState({ salesRepUserId: c.salesRepUserId ?? "", salesTerritoryId: c.salesTerritoryId ?? "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reps, territories } = usePerformanceOptions(editing);
  // Keep the order's current (possibly inactive) territory selectable.
  const territoryOptions = c.salesTerritoryId && !territories.some((t) => t.id === c.salesTerritoryId) ? [{ id: c.salesTerritoryId, label: c.salesTerritory ?? "Current territory" }, ...territories] : territories;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="credit-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="credit-h" className="font-semibold text-zinc-900 dark:text-zinc-50">
          Sales credit
        </h2>
        <div className="flex gap-2">
          {c.history.length > 0 && (
            <Button size="xs" variant="secondary" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide changes" : `Changes (${c.history.length})`}
            </Button>
          )}
          {canChange && (
            <Button size="xs" variant="secondary" onClick={() => (setError(null), setForm({ salesRepUserId: c.salesRepUserId ?? "", salesTerritoryId: c.salesTerritoryId ?? "", reason: "" }), setEditing(true))}>
              Change
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1">
        Rep: <strong>{c.salesRep ?? "None"}</strong> · Territory: <strong>{c.salesTerritory ?? "None"}</strong>
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        {c.source === "MANUAL" && c.changedBy ? `Changed by ${c.changedBy} ${c.changedAt ? formatDateTime(c.changedAt) : ""}: ${c.reason}` : c.sourceLabel ? `Set automatically — ${c.sourceLabel.toLowerCase()}.` : ""} Counts once, for this rep and territory, in targets and team performance.
      </p>
      {showHistory && (
        <div className="mt-3">
          <EventList events={c.history} />
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(false)} title="Change sales credit">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const res = await fetch(`/api/v1/sales-marketing/performance/orders/${orderId}/credit`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify(form) });
              setBusy(false);
              if (!res.ok) return setError(await getApiErrorMessage(res));
              setC((await res.json()).data);
              setEditing(false);
            }}
          >
            <FormField label="Sales rep" htmlFor="cr-rep" required>
              <SearchableSelect id="cr-rep" required value={form.salesRepUserId} onChange={(salesRepUserId) => setForm({ ...form, salesRepUserId })} options={reps.length ? reps : c.salesRepUserId ? [{ id: c.salesRepUserId, label: c.salesRep ?? "" }] : []} placeholder="Search people…" />
            </FormField>
            <FormField label="Territory" htmlFor="cr-terr">
              <SearchableSelect id="cr-terr" value={form.salesTerritoryId} onChange={(salesTerritoryId) => setForm({ ...form, salesTerritoryId })} options={territoryOptions} placeholder="Search territories…" emptyOptionLabel="— No territory —" />
            </FormField>
            <FormField label="Reason" htmlFor="cr-reason" required>
              <textarea id="cr-reason" rows={2} required minLength={3} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={textInputClass()} />
            </FormField>
            <p className="text-xs text-zinc-500">This moves the whole order to the chosen rep and territory in every report, for its order date.</p>
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

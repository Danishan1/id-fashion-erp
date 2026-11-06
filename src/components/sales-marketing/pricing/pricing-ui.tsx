"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatDateTime } from "@/lib/date-format";
import { PRICING_EVENT_TYPES, type PricingEventType } from "@/modules/sales-marketing/pricing/pricing-registry";

/** Shared bits of the pricing screens (Phase 03). */

export const CARD = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
export const inr = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "green" | "amber" | "indigo" | "red" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    green: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export interface Lookup {
  id: string;
  label: string;
  sublabel?: string;
}

/** Styles, units, customers, categories for the pickers (masters APIs). */
export function useLookups(which: ("styles" | "units" | "customers" | "categories")[]) {
  const [data, setData] = useState<Record<string, Lookup[]>>({});
  const key = which.join(",");
  useEffect(() => {
    const opts = { headers: { "x-toast": "off" } };
    const get = (url: string) => fetch(url, opts).then((r) => (r.ok ? r.json() : { data: [] })).then((b) => (b.data ?? []) as Record<string, unknown>[]);
    const wanted = key.split(",");
    Promise.all([
      wanted.includes("styles") ? get("/api/v1/products?pageSize=200") : Promise.resolve([]),
      wanted.includes("units") ? get("/api/v1/units") : Promise.resolve([]),
      wanted.includes("customers") ? get("/api/v1/customers?pageSize=200") : Promise.resolve([]),
      wanted.includes("categories") ? get("/api/v1/categories") : Promise.resolve([]),
    ])
      .then(([styles, units, customers, categories]) =>
        setData({
          styles: styles.map((s) => ({ id: String(s.id), label: String(s.styleName ?? ""), sublabel: s.styleCode ? String(s.styleCode) : undefined })),
          units: units.filter((u) => u.isActive !== false).map((u) => ({ id: String(u.id), label: String(u.code ?? ""), sublabel: u.name ? String(u.name) : undefined })),
          customers: customers.map((c) => ({ id: String(c.id), label: String(c.name ?? ""), sublabel: c.code ? String(c.code) : undefined })),
          categories: categories.map((c) => ({ id: String(c.id), label: String(c.name ?? "") })),
        })
      )
      .catch(() => undefined);
  }, [key]);
  return { styles: data.styles ?? [], units: data.units ?? [], customers: data.customers ?? [], categories: data.categories ?? [] };
}

// ── Price entries editor ─────────────────────────────────────────

export interface EntryDraft {
  key: string;
  productId: string;
  uomId: string;
  minQuantity: string;
  unitPrice: string;
  notes: string;
}

let seq = 0;
export const newEntry = (uomId = ""): EntryDraft => ({ key: `e${Date.now().toString(36)}${(seq++).toString(36)}`, productId: "", uomId, minQuantity: "0", unitPrice: "", notes: "" });

export function toEntryDrafts(entries: { productId: string; uomId: string; minQuantity: string | number; unitPrice: string | number; notes: string | null }[]): EntryDraft[] {
  return entries.map((e) => ({ ...newEntry(), productId: e.productId, uomId: e.uomId, minQuantity: String(Number(e.minQuantity)), unitPrice: String(Number(e.unitPrice)), notes: e.notes ?? "" }));
}

export const entryPayload = (entries: EntryDraft[]) =>
  entries.map((e) => ({ productId: e.productId, uomId: e.uomId, minQuantity: e.minQuantity === "" ? 0 : e.minQuantity, unitPrice: e.unitPrice, notes: e.notes }));

/**
 * Prices of one version: Style, unit, from quantity (all-units break), price.
 * Several rows for the same Style and unit with different "from" quantities
 * are quantity breaks — the highest "from" not above the ordered quantity wins.
 */
export function PriceEntriesEditor({ entries, onChange, styles, units }: { entries: EntryDraft[]; onChange: (e: EntryDraft[]) => void; styles: Lookup[]; units: Lookup[] }) {
  const pcs = units.find((u) => u.label === "PCS")?.id ?? "";
  const set = (key: string, patch: Partial<EntryDraft>) => onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="py-1.5 pr-2 font-medium">Style</th>
              <th className="w-28 py-1.5 pr-2 font-medium">Unit</th>
              <th className="w-32 py-1.5 pr-2 font-medium">From quantity</th>
              <th className="w-36 py-1.5 pr-2 font-medium">Price (₹ per unit)</th>
              <th className="py-1.5 pr-2 font-medium">Note</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.key} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1.5 pr-2">
                  <SearchableSelect id={`entry-style-${i}`} required value={e.productId} onChange={(productId) => set(e.key, { productId })} options={styles} placeholder="Search style…" />
                </td>
                <td className="py-1.5 pr-2">
                  <select aria-label={`Unit for price ${i + 1}`} required value={e.uomId} onChange={(ev) => set(e.key, { uomId: ev.target.value })} className={textInputClass()}>
                    <option value="">—</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <input aria-label={`From quantity for price ${i + 1}`} type="number" min={0} step="0.001" value={e.minQuantity} onChange={(ev) => set(e.key, { minQuantity: ev.target.value })} className={textInputClass()} />
                </td>
                <td className="py-1.5 pr-2">
                  <input aria-label={`Price ${i + 1}`} type="number" required min={0} step="0.01" value={e.unitPrice} onChange={(ev) => set(e.key, { unitPrice: ev.target.value })} className={textInputClass()} />
                </td>
                <td className="py-1.5 pr-2">
                  <input aria-label={`Note for price ${i + 1}`} maxLength={300} value={e.notes} onChange={(ev) => set(e.key, { notes: ev.target.value })} className={textInputClass()} />
                </td>
                <td className="py-1.5 text-right">
                  <button type="button" onClick={() => onChange(entries.filter((x) => x.key !== e.key))} className="text-xs font-medium text-red-600 hover:text-red-500">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 && <p className="text-sm text-zinc-500">No prices yet.</p>}
      <Button type="button" size="xs" variant="secondary" onClick={() => onChange([...entries, newEntry(pcs)])}>
        + Add price
      </Button>
      <p className="text-xs text-zinc-500">
        Quantity breaks: add several rows for the same Style and unit with different &ldquo;from&rdquo; quantities — the highest one not above the ordered quantity prices the whole line (e.g. from 0 → ₹100, from 500 → ₹90: 500 pieces cost ₹90 each).
      </p>
    </div>
  );
}

/** Read-only price table. */
export function PriceEntriesTable({ entries }: { entries: { id: string; product: { styleName: string; styleCode: string }; uom: { code: string }; minQuantity: string | number; unitPrice: string | number; notes: string | null }[] }) {
  if (!entries.length) return <p className="text-sm text-zinc-500">No prices in this version.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <th className="py-1.5 pr-3 font-medium">Style</th>
            <th className="py-1.5 pr-3 font-medium">Unit</th>
            <th className="py-1.5 pr-3 text-right font-medium">From qty</th>
            <th className="py-1.5 pr-3 text-right font-medium">Price</th>
            <th className="py-1.5 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="py-1.5 pr-3">
                {e.product.styleName} <span className="text-xs text-zinc-500">{e.product.styleCode}</span>
              </td>
              <td className="py-1.5 pr-3">{e.uom.code}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{Number(e.minQuantity) > 0 ? `${Number(e.minQuantity).toLocaleString("en-IN")}+` : "any"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{inr(e.unitPrice)}</td>
              <td className="py-1.5 text-zinc-500">{e.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── History & small dialog ───────────────────────────────────────

export function PricingHistory({ events }: { events: { id: string; type: string; versionNumber: number | null; comment: string | null; createdAt: string; createdBy: { fullName: string } | null }[] }) {
  if (!events.length) return <p className="text-sm text-zinc-500">No history yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {events.map((e) => (
        <li key={e.id}>
          <span className="font-medium">{PRICING_EVENT_TYPES[e.type as PricingEventType] ?? e.type}</span>
          {e.versionNumber ? <span className="text-zinc-500"> · v{e.versionNumber}</span> : null}
          {e.comment && <span className="text-zinc-600 dark:text-zinc-300"> — {e.comment}</span>}
          <div className="text-xs text-zinc-500">
            {e.createdBy?.fullName ?? "—"} · {formatDateTime(e.createdAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface TextDialogSpec {
  action: string;
  title: string;
  help?: string;
  field?: { name: "comment" | "reason"; label: string; required: boolean };
  submitLabel: string;
  danger?: boolean;
}

export function TextDialog({ spec, busy, error, onClose, onSubmit }: { spec: TextDialogSpec; busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: Record<string, string>) => void }) {
  const [text, setText] = useState("");
  return (
    <Modal open onClose={onClose} title={spec.title}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(spec.field && text ? { [spec.field.name]: text } : {});
        }}
      >
        {spec.help && <p className="text-sm text-zinc-600 dark:text-zinc-300">{spec.help}</p>}
        {spec.field && (
          <FormField label={spec.field.label} htmlFor="dialog-text" required={spec.field.required}>
            <textarea id="dialog-text" rows={3} required={spec.field.required} minLength={spec.field.required ? 3 : undefined} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} className={textInputClass()} />
          </FormField>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" variant={spec.danger ? "danger" : "primary"} isLoading={busy} loadingLabel="Saving…">
            {spec.submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { todayIsoDate } from "@/lib/date";
import { CARD, PriceEntriesEditor, entryPayload, useLookups, type EntryDraft } from "./pricing-ui";

/** New price list: header + version 1 (draft) with its prices. */
export function PriceListCreateForm() {
  const router = useRouter();
  const { styles, units, customers } = useLookups(["styles", "units", "customers"]);
  const [v, setV] = useState({ code: "", name: "", description: "", kind: "DEFAULT" as "DEFAULT" | "CUSTOMER", customerId: "", priority: "0", effectiveFrom: todayIsoDate(), effectiveTo: "", changeNote: "" });
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((p) => ({ ...p, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/v1/sales-marketing/pricing/price-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toast": "off" },
      body: JSON.stringify({ ...v, customerId: v.kind === "CUSTOMER" ? v.customerId : "", entries: entryPayload(entries) }),
    });
    setSaving(false);
    if (!res.ok) return setError(await getApiErrorMessage(res, "Couldn't create the price list."));
    const { data } = await res.json();
    router.push(`/sales-marketing/pricing/${data.id}`);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className={`${CARD} space-y-4`}>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Code" htmlFor="code" required>
            <input id="code" required maxLength={40} value={v.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="e.g. STD-2026" className={textInputClass()} />
          </FormField>
          <FormField label="Name" htmlFor="name" required>
            <input id="name" required maxLength={200} value={v.name} onChange={(e) => set({ name: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Priority (higher wins)" htmlFor="priority" required>
            <input id="priority" type="number" required min={-1000} max={1000} step={1} value={v.priority} onChange={(e) => set({ priority: e.target.value })} className={textInputClass()} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="For" htmlFor="kind" required>
            <select id="kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as "DEFAULT" | "CUSTOMER", customerId: "" })} className={textInputClass()}>
              <option value="DEFAULT">Everyone (default prices)</option>
              <option value="CUSTOMER">One customer</option>
            </select>
          </FormField>
          {v.kind === "CUSTOMER" && (
            <FormField label="Customer" htmlFor="customerId" required>
              <SearchableSelect id="customerId" required value={v.customerId} onChange={(customerId) => set({ customerId })} options={customers} placeholder="Search customer…" />
            </FormField>
          )}
        </div>
        <FormField label="Description" htmlFor="description">
          <textarea id="description" rows={2} maxLength={1000} value={v.description} onChange={(e) => set({ description: e.target.value })} className={textInputClass()} />
        </FormField>
      </section>

      <section className={`${CARD} space-y-4`}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Version 1 (draft)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Prices apply from" htmlFor="effectiveFrom" required>
            <input id="effectiveFrom" type="date" required value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Until (optional)" htmlFor="effectiveTo">
            <input id="effectiveTo" type="date" min={v.effectiveFrom} value={v.effectiveTo} onChange={(e) => set({ effectiveTo: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Note" htmlFor="changeNote">
            <input id="changeNote" maxLength={1000} value={v.changeNote} onChange={(e) => set({ changeNote: e.target.value })} className={textInputClass()} />
          </FormField>
        </div>
        <PriceEntriesEditor entries={entries} onChange={setEntries} styles={styles} units={units} />
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" isLoading={saving} loadingLabel="Saving…">
          Create draft price list
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/sales-marketing/pricing")}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-zinc-500">The prices are used only after someone else approves this version.</p>
    </form>
  );
}

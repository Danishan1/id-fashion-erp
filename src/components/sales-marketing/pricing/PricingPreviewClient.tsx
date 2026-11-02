"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { todayIsoDate } from "@/lib/date";
import { Badge, CARD, inr, useLookups } from "./pricing-ui";

interface Result {
  status: "PRICED" | "NO_PRICE" | "CONFLICT" | "INVALID";
  quantity: number;
  uomCode: string | null;
  listUnitPrice: number | null;
  ruleDiscountAmount: number | null;
  ruleDiscountCapped: boolean;
  netUnitPrice: number | null;
  extendedAmount: number | null;
  message: string | null;
  explanation: string[];
  source: { level: string; priceListCode: string; priceListName: string; versionNumber: number; minQuantity: number; entryUomCode: string } | null;
  rules: { code: string; name: string; discountPerUnit: number; stacking: string }[];
  skipped: { kind: string; code: string; reason: string }[];
}

/** What a Style would cost for a customer, quantity and date — nothing is saved. */
export function PricingPreviewClient() {
  const { styles, units, customers } = useLookups(["styles", "units", "customers"]);
  const [v, setV] = useState({ productId: "", quantity: "100", uomId: "", customerId: "", date: todayIsoDate() });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/sales-marketing/pricing/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toast": "off" },
      body: JSON.stringify({ date: v.date, customerId: v.customerId || null, lines: [{ productId: v.productId, quantity: v.quantity, uomId: v.uomId || null }] }),
    });
    setBusy(false);
    if (!res.ok) {
      setResult(null);
      return setError(await getApiErrorMessage(res));
    }
    setResult((await res.json()).data[0]);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={run} className={`${CARD} grid gap-4 sm:grid-cols-6`}>
        <div className="sm:col-span-2">
          <FormField label="Style" htmlFor="pv-style" required>
            <SearchableSelect id="pv-style" required value={v.productId} onChange={(productId) => setV({ ...v, productId })} options={styles} placeholder="Search style…" />
          </FormField>
        </div>
        <FormField label="Quantity" htmlFor="pv-qty" required>
          <input id="pv-qty" type="number" required min={0.001} step="0.001" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Unit" htmlFor="pv-unit">
          <select id="pv-unit" value={v.uomId} onChange={(e) => setV({ ...v, uomId: e.target.value })} className={textInputClass()}>
            <option value="">Style&apos;s base unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Customer" htmlFor="pv-customer">
          <SearchableSelect id="pv-customer" value={v.customerId} onChange={(customerId) => setV({ ...v, customerId })} options={customers} placeholder="Prospect / any" />
        </FormField>
        <FormField label="Date" htmlFor="pv-date" required>
          <input id="pv-date" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} className={textInputClass()} />
        </FormField>
        <div className="sm:col-span-6">
          <Button type="submit" isLoading={busy} loadingLabel="Pricing…">
            Show price
          </Button>
        </div>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <section className={`${CARD} space-y-3 text-sm`}>
          {result.status === "PRICED" ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div>
                  List price <strong className="tabular-nums">{inr(result.listUnitPrice)}</strong>
                </div>
                <div>
                  Rule discount <strong className="tabular-nums">{result.ruleDiscountAmount ? `−${inr(result.ruleDiscountAmount)}` : "—"}</strong>
                  {result.ruleDiscountCapped && <span className="text-xs text-amber-700 dark:text-amber-400"> (capped)</span>}
                </div>
                <div className="text-base">
                  Net <strong className="tabular-nums">{inr(result.netUnitPrice)}</strong> per {result.uomCode}
                </div>
                <div>
                  {result.quantity.toLocaleString("en-IN")} {result.uomCode} = <strong className="tabular-nums">{inr(result.extendedAmount)}</strong>{" "}
                  <span className="text-xs text-zinc-500">before GST and manual discount</span>
                </div>
              </div>
              <ul className="list-disc space-y-0.5 pl-5">
                {result.explanation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              <Badge tone={result.status === "CONFLICT" ? "red" : "amber"}>{result.status === "CONFLICT" ? "Conflict" : result.status === "INVALID" ? "Can't price" : "No price"}</Badge> {result.message}
            </p>
          )}
          {result.skipped.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Not used</h3>
              <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-300">
                {result.skipped.map((s) => (
                  <li key={`${s.kind}-${s.code}`}>
                    {s.kind === "RULE" ? "Rule" : "Price list"} <strong>{s.code}</strong>: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

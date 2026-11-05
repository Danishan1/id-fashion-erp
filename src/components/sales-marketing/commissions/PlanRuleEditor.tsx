"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { commissionFor, tierProblems, type CommissionRule } from "@/modules/sales-marketing/commissions/commission-engine";
import { inr } from "./commission-ui";

export interface RuleDraft {
  effectiveFrom: string;
  effectiveTo: string;
  method: "PERCENT" | "FIXED";
  tierMode: "ALL_UNITS" | "PROGRESSIVE";
  tiers: { from: string; rate: string }[];
  fixedAmount: string;
  minimumBasis: string;
  capAmount: string;
  notes: string;
}

export const emptyRule = (today: string): RuleDraft => ({
  effectiveFrom: today,
  effectiveTo: "",
  method: "PERCENT",
  tierMode: "ALL_UNITS",
  tiers: [{ from: "0", rate: "" }],
  fixedAmount: "",
  minimumBasis: "",
  capAmount: "",
  notes: "",
});

export interface VersionView {
  effectiveFrom: string;
  effectiveTo: string | null;
  method: "PERCENT" | "FIXED";
  tierMode: "ALL_UNITS" | "PROGRESSIVE";
  tiers: { from: number; rate: number }[];
  fixedAmount: number | null;
  minimumBasis: number | null;
  capAmount: number | null;
  notes: string | null;
}

export const toRuleDraft = (v: VersionView): RuleDraft => ({
  effectiveFrom: v.effectiveFrom,
  effectiveTo: v.effectiveTo ?? "",
  method: v.method,
  tierMode: v.tierMode,
  tiers: v.tiers.length ? v.tiers.map((t) => ({ from: String(t.from), rate: String(t.rate) })) : [{ from: "0", rate: "" }],
  fixedAmount: v.fixedAmount === null ? "" : String(v.fixedAmount),
  minimumBasis: v.minimumBasis === null ? "" : String(v.minimumBasis),
  capAmount: v.capAmount === null ? "" : String(v.capAmount),
  notes: v.notes ?? "",
});

export const rulePayload = (r: RuleDraft) => ({
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  method: r.method,
  tierMode: r.tierMode,
  tiers: r.method === "PERCENT" ? r.tiers.map((t) => ({ from: t.from === "" ? 0 : Number(t.from), rate: t.rate === "" ? 0 : Number(t.rate) })) : [],
  fixedAmount: r.method === "FIXED" ? r.fixedAmount : "",
  minimumBasis: r.minimumBasis,
  capAmount: r.capAmount,
  notes: r.notes,
});

const n = (v: string) => (v === "" ? null : Number(v));
function ruleOf(r: RuleDraft): CommissionRule {
  return {
    method: r.method,
    tierMode: r.tierMode,
    tiers: r.tiers.map((t) => ({ from: Number(t.from || 0), rate: Number(t.rate || 0) })),
    fixedAmount: n(r.fixedAmount),
    minimumBasis: n(r.minimumBasis),
    capAmount: n(r.capAmount),
  };
}

/** The rule fields of a plan version, with a live worked example from the same engine statements use. */
export function RuleEditor({ value, onChange, basis }: { value: RuleDraft; onChange: (next: RuleDraft) => void; basis: "INVOICED" | "COLLECTED" }) {
  const [sample, setSample] = useState("150000");
  const [sampleInvoices, setSampleInvoices] = useState("3");
  const set = (patch: Partial<RuleDraft>) => onChange({ ...value, ...patch });
  const rule = ruleOf(value);
  const problems = value.method === "PERCENT" ? tierProblems(rule.tiers) : [];
  const example = problems.length ? null : commissionFor(rule, Number(sample || 0), value.method === "FIXED" ? Number(sampleInvoices || 0) : 1);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="In force from" htmlFor="r-from" required>
          <input id="r-from" type="date" required value={value.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Until (optional)" htmlFor="r-to">
          <input id="r-to" type="date" value={value.effectiveTo} onChange={(e) => set({ effectiveTo: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 font-medium text-zinc-700 dark:text-zinc-200">Commission</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="r-method" checked={value.method === "PERCENT"} onChange={() => set({ method: "PERCENT" })} /> Percentage of the basis
        </label>
        <label className={`flex items-center gap-2 ${basis !== "INVOICED" ? "text-zinc-400" : ""}`}>
          <input type="radio" name="r-method" disabled={basis !== "INVOICED"} checked={value.method === "FIXED"} onChange={() => set({ method: "FIXED" })} /> Fixed amount per posted invoice
          {basis !== "INVOICED" && <span className="text-xs">(invoiced basis only)</span>}
        </label>
      </fieldset>

      {value.method === "PERCENT" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="r-mode" checked={value.tierMode === "ALL_UNITS"} onChange={() => set({ tierMode: "ALL_UNITS" })} /> All-units — the tier reached sets the rate for the whole month&apos;s basis
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="r-mode" checked={value.tierMode === "PROGRESSIVE"} onChange={() => set({ tierMode: "PROGRESSIVE" })} /> Progressive — each slice at its own rate
            </label>
          </div>
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="pr-2 font-medium">Monthly basis from (₹)</th>
                <th className="pr-2 font-medium">Rate %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {value.tiers.map((t, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`Tier ${i + 1} from`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={t.from}
                      disabled={i === 0}
                      onChange={(e) => set({ tiers: value.tiers.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })}
                      className={`${textInputClass()} !w-40`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`Tier ${i + 1} rate`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.0001"
                      required
                      value={t.rate}
                      onChange={(e) => set({ tiers: value.tiers.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)) })}
                      className={`${textInputClass()} !w-28`}
                    />
                  </td>
                  <td className="py-1">
                    {i > 0 && (
                      <Button type="button" size="xs" variant="secondary" onClick={() => set({ tiers: value.tiers.filter((_, k) => k !== i) })}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {value.tiers.length < 10 && (
            <Button type="button" size="xs" variant="secondary" onClick={() => set({ tiers: [...value.tiers, { from: "", rate: "" }] })}>
              Add tier
            </Button>
          )}
          {problems.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{problems.join(" ")}</p>}
        </div>
      ) : (
        <FormField label="Amount per posted invoice (₹)" htmlFor="r-fixed" required>
          <input id="r-fixed" type="number" min={0} step="0.01" required value={value.fixedAmount} onChange={(e) => set({ fixedAmount: e.target.value })} className={textInputClass()} />
        </FormField>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Minimum monthly basis (₹, optional)" htmlFor="r-min">
          <input id="r-min" type="number" min={0} step="0.01" value={value.minimumBasis} onChange={(e) => set({ minimumBasis: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Monthly cap (₹, optional)" htmlFor="r-cap">
          <input id="r-cap" type="number" min={0} step="0.01" value={value.capAmount} onChange={(e) => set({ capAmount: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <FormField label="Notes" htmlFor="r-notes">
        <textarea id="r-notes" rows={2} maxLength={2000} value={value.notes} onChange={(e) => set({ notes: e.target.value })} className={textInputClass()} />
      </FormField>

      <div className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Worked example:</span> a month with basis ₹
          <input aria-label="Example basis" type="number" min={0} value={sample} onChange={(e) => setSample(e.target.value)} className={`${textInputClass()} !w-36`} />
          {value.method === "FIXED" && (
            <>
              from
              <input aria-label="Example invoices" type="number" min={0} value={sampleInvoices} onChange={(e) => setSampleInvoices(e.target.value)} className={`${textInputClass()} !w-20`} />
              invoices
            </>
          )}
        </div>
        {example && (
          <p className="mt-2">
            Commission <strong>{inr(example.amount)}</strong>
            {example.effectiveRate !== null && ` (effective ${example.effectiveRate}%)`}
            {example.belowMinimum && " — below the minimum basis, nothing is paid"}
            {example.capped && ` — capped (${inr(example.gross)} before the cap)`}
            {example.slices.length > 1 && <span className="block text-xs text-zinc-500">{example.slices.map((s) => `${inr(s.basis)} × ${s.rate}% = ${inr(s.amount)}`).join(" + ")}</span>}
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-500">Illustration only — statements use the real posted {basis === "INVOICED" ? "invoices" : "collections"}.</p>
      </div>
    </div>
  );
}

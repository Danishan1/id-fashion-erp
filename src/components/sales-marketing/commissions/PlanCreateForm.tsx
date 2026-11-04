"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { BASIS_HINTS, CARD, send } from "./commission-ui";
import { RuleEditor, emptyRule, rulePayload } from "./PlanRuleEditor";

/** New commission plan: header + its first (draft) version. */
export function PlanCreateForm({ today }: { today: string }) {
  const router = useRouter();
  const [head, setHead] = useState({ code: "", name: "", description: "", payeeType: "REP" as "REP" | "AGENT", basis: "INVOICED" as "INVOICED" | "COLLECTED" });
  const [rule, setRule] = useState(emptyRule(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={`${CARD} max-w-3xl space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const plan = await send<{ id: string }>("/api/v1/sales-marketing/commissions/plans", "POST", { ...head, ...rulePayload(rule) });
          router.push(`/sales-marketing/commissions/plans/${plan.id}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Code" htmlFor="p-code" required>
          <input id="p-code" required maxLength={40} value={head.code} onChange={(e) => setHead({ ...head, code: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Name" htmlFor="p-name" required>
          <input id="p-name" required maxLength={200} value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="p-desc">
        <textarea id="p-desc" rows={2} maxLength={1000} value={head.description} onChange={(e) => setHead({ ...head, description: e.target.value })} className={textInputClass()} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Paid to" htmlFor="p-payee" required>
          <select id="p-payee" value={head.payeeType} onChange={(e) => setHead({ ...head, payeeType: e.target.value as "REP" | "AGENT" })} className={textInputClass()}>
            <option value="REP">Sales reps (the order&apos;s sales credit)</option>
            <option value="AGENT">Sales agents (the order&apos;s sales agent)</option>
          </select>
        </FormField>
        <FormField label="Basis" htmlFor="p-basis" required>
          <select
            id="p-basis"
            value={head.basis}
            onChange={(e) => {
              const basis = e.target.value as "INVOICED" | "COLLECTED";
              setHead({ ...head, basis });
              if (basis === "COLLECTED" && rule.method === "FIXED") setRule({ ...rule, method: "PERCENT" });
            }}
            className={textInputClass()}
          >
            <option value="INVOICED">Invoiced value</option>
            <option value="COLLECTED">Collected value</option>
          </select>
        </FormField>
      </div>
      <p className="text-xs text-zinc-500">{BASIS_HINTS[head.basis]} Payee and basis can&apos;t be changed later.</p>
      <h2 className="border-t border-zinc-200 pt-3 text-sm font-semibold dark:border-zinc-800">Version 1 (draft)</h2>
      <RuleEditor value={rule} onChange={setRule} basis={head.basis} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" isLoading={busy}>
          Create plan
        </Button>
      </div>
    </form>
  );
}

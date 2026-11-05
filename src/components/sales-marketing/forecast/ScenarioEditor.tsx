"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-format";
import type { SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { CARD, PeriodPicker } from "../performance/performance-ui";
import { ScenarioComparison, type ComparisonView } from "./ScenarioComparison";

export interface Assumptions {
  probabilityFactor: number;
  slipDays: number;
  includeOverdue: boolean;
  includeQuotations: boolean;
  includeOpportunities: boolean;
  trendGrowth: number;
}

export interface ScenarioView {
  id: string;
  name: string;
  description: string | null;
  periodType: SalesTargetPeriodTypeKey;
  periodStart: string;
  assumptions: Assumptions;
  archived: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
  live: ComparisonView;
  stored: { calculatedAt: string | null } | null;
}

const DEFAULTS: Assumptions = { probabilityFactor: 100, slipDays: 0, includeOverdue: false, includeQuotations: true, includeOpportunities: true, trendGrowth: 0 };

/** Create or edit a what-if scenario, with a live baseline-vs-scenario preview. */
export function ScenarioEditor({
  fiscalStartMonth,
  today,
  initialPeriod,
  existing,
  canSave,
  canEdit,
}: {
  fiscalStartMonth: number;
  today: string;
  initialPeriod: { periodType: SalesTargetPeriodTypeKey; periodStart: string };
  existing?: ScenarioView;
  canSave: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(existing);
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [period, setPeriod] = useState(existing ? { periodType: existing.periodType, periodStart: existing.periodStart } : initialPeriod);
  const [a, setA] = useState<Assumptions>(existing?.assumptions ?? DEFAULTS);
  const [result, setResult] = useState<ComparisonView | null>(existing?.live ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = existing ? canEdit && !s?.archived : canSave;
  const headers = { "Content-Type": "application/json", "x-toast": "off" };
  const num = (v: string) => (v === "" ? 0 : Number(v));

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(await getApiErrorMessage(res));
      return null;
    }
    return (await res.json()).data;
  };

  return (
    <div className="space-y-4">
      <form
        className={`${CARD} grid gap-4 sm:grid-cols-2`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (existing) {
            const d = await call(`/api/v1/sales-marketing/forecast/scenarios/${existing.id}`, "PATCH", { name, description, assumptions: a, version: s!.version });
            if (d) {
              setS(d);
              setResult(d.live);
            }
          } else {
            const d = await call("/api/v1/sales-marketing/forecast/scenarios", "POST", { name, description, ...period, assumptions: a });
            if (d) router.push(`/sales-marketing/forecast/scenarios/${d.id}`);
          }
        }}
      >
        {(editable || !existing) && (
          <>
            <FormField label="Name" htmlFor="sc-name" required>
              <input id="sc-name" required={canSave || Boolean(existing)} maxLength={200} disabled={!editable} value={name} onChange={(e) => setName(e.target.value)} className={textInputClass()} placeholder="e.g. Cautious — 20% fewer wins" />
            </FormField>
            <FormField label="Description" htmlFor="sc-desc">
              <input id="sc-desc" maxLength={1000} disabled={!editable} value={description} onChange={(e) => setDescription(e.target.value)} className={textInputClass()} />
            </FormField>
          </>
        )}
        <div className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Period</span>
          {existing ? <p className="text-sm">{existing.live.period.label}</p> : <PeriodPicker {...period} fiscalStartMonth={fiscalStartMonth} today={today} back={0} ahead={6} onChange={setPeriod} />}
        </div>
        <FormField label="Probabilities × (%) — 100 = as they are" htmlFor="sc-prob">
          <input id="sc-prob" type="number" min={0} max={200} step={5} disabled={!editable} value={a.probabilityFactor} onChange={(e) => setA({ ...a, probabilityFactor: num(e.target.value) })} className={textInputClass()} />
        </FormField>
        <FormField label="Push expected dates later by (days)" htmlFor="sc-slip">
          <input id="sc-slip" type="number" min={0} max={365} step={1} disabled={!editable} value={a.slipDays} onChange={(e) => setA({ ...a, slipDays: num(e.target.value) })} className={textInputClass()} />
        </FormField>
        <FormField label="Trend growth (%)" htmlFor="sc-growth">
          <input id="sc-growth" type="number" min={-100} max={200} step={1} disabled={!editable} value={a.trendGrowth} onChange={(e) => setA({ ...a, trendGrowth: num(e.target.value) })} className={textInputClass()} />
        </FormField>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!editable} checked={a.includeOverdue} onChange={(e) => setA({ ...a, includeOverdue: e.target.checked })} />
            Count overdue items as expected today
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!editable} checked={a.includeQuotations} onChange={(e) => setA({ ...a, includeQuotations: e.target.checked })} />
            Include quotations
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!editable} checked={a.includeOpportunities} onChange={(e) => setA({ ...a, includeOpportunities: e.target.checked })} />
            Include CRM opportunities
          </label>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button
            type="button"
            variant="secondary"
            isLoading={busy}
            onClick={async () => {
              const d = await call("/api/v1/sales-marketing/forecast/scenarios/preview", "POST", { ...period, assumptions: a });
              if (d) setResult(d);
            }}
          >
            Preview
          </Button>
          {editable && (
            <Button type="submit" isLoading={busy}>
              {existing ? "Save changes" : "Save scenario"}
            </Button>
          )}
          {existing && editable && (
            <Button
              type="button"
              variant="danger"
              isLoading={busy}
              onClick={async () => {
                const d = await call(`/api/v1/sales-marketing/forecast/scenarios/${existing.id}/archive`, "POST");
                if (d) setS(d);
              }}
            >
              Archive
            </Button>
          )}
        </div>
        {existing && s && (
          <p className="text-xs text-zinc-500 sm:col-span-2">
            Created by {s.createdBy}; last changed by {s.updatedBy} {formatDateTime(s.updatedAt)}
            {s.stored?.calculatedAt ? ` · result saved ${formatDateTime(s.stored.calculatedAt)}` : ""}
            {s.archived ? " · archived" : ""}. The figures below are recalculated now from live data.
          </p>
        )}
      </form>
      {result && (
        <section className={CARD}>
          <ScenarioComparison c={result} />
        </section>
      )}
    </div>
  );
}

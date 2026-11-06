"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { periodContaining } from "@/modules/sales-marketing/performance/performance-periods";
import { SALES_TARGET_METRICS, SALES_TARGET_SCOPES, metricDefinition, type SalesTargetMetricKey, type SalesTargetPeriodTypeKey, type SalesTargetScopeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { CARD, PeriodPicker, usePerformanceOptions } from "./performance-ui";

/** New sales target: scope + subject + metric + one whole period + value; saved as a draft, optionally submitted at once. */
export function TargetCreateForm({ fiscalStartMonth, today, canSeeCompany }: { fiscalStartMonth: number; today: string; canSeeCompany: boolean }) {
  const router = useRouter();
  const { reps, territories } = usePerformanceOptions();
  const [scope, setScope] = useState<SalesTargetScopeKey>("REP");
  const [userId, setUserId] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [metric, setMetric] = useState<SalesTargetMetricKey>("BOOKED_ORDER_VALUE");
  const [period, setPeriod] = useState<{ periodType: SalesTargetPeriodTypeKey; periodStart: string }>({ periodType: "MONTH", periodStart: periodContaining("MONTH", today, fiscalStartMonth).start });
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [submitNow, setSubmitNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = metricDefinition(metric);
  const scopes = SALES_TARGET_SCOPES.filter((s) => s.key !== "COMPANY" || canSeeCompany);

  return (
    <form
      className={`${CARD} grid max-w-3xl gap-4 sm:grid-cols-2`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const headers = { "Content-Type": "application/json", "x-toast": "off" };
        const res = await fetch("/api/v1/sales-marketing/performance/targets", {
          method: "POST",
          headers,
          body: JSON.stringify({ scope, userId: scope === "REP" || scope === "TEAM" ? userId : null, territoryId: scope === "TERRITORY" ? territoryId : null, metric, ...period, targetValue: value, notes }),
        });
        if (!res.ok) {
          setBusy(false);
          return setError(await getApiErrorMessage(res));
        }
        const { data } = await res.json();
        if (submitNow) {
          const sub = await fetch(`/api/v1/sales-marketing/performance/targets/${data.id}/revisions/${data.revisions[0].id}/submit`, { method: "POST", headers, body: "{}" });
          if (!sub.ok) {
            // The draft exists; open it so the user sees why submitting failed.
            router.push(`/sales-marketing/targets/${data.id}`);
            return;
          }
        }
        router.push(`/sales-marketing/targets/${data.id}`);
      }}
    >
      <FormField label="Target for" htmlFor="tg-scope" required>
        <select id="tg-scope" value={scope} onChange={(e) => setScope(e.target.value as SalesTargetScopeKey)} className={textInputClass()}>
          {scopes.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">{SALES_TARGET_SCOPES.find((s) => s.key === scope)?.hint}</p>
      </FormField>
      {(scope === "REP" || scope === "TEAM") && (
        <FormField label={scope === "REP" ? "Sales rep" : "Team manager"} htmlFor="tg-user" required>
          <SearchableSelect id="tg-user" required value={userId} onChange={setUserId} options={reps} placeholder="Search people…" />
        </FormField>
      )}
      {scope === "TERRITORY" && (
        <FormField label="Territory" htmlFor="tg-territory" required>
          <SearchableSelect id="tg-territory" required value={territoryId} onChange={setTerritoryId} options={territories} placeholder="Search territories…" />
        </FormField>
      )}
      {scope === "COMPANY" && <div />}

      <div className="sm:col-span-2">
        <FormField label="Metric" htmlFor="tg-metric" required>
          <select id="tg-metric" value={metric} onChange={(e) => setMetric(e.target.value as SalesTargetMetricKey)} className={textInputClass()}>
            {SALES_TARGET_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            {def.definition} Date: {def.dateBasis.toLowerCase()}.
          </p>
        </FormField>
      </div>

      <div className="sm:col-span-2">
        <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Period</span>
        <PeriodPicker {...period} fiscalStartMonth={fiscalStartMonth} today={today} back={0} ahead={6} onChange={setPeriod} />
      </div>

      <FormField label={def.unit === "CURRENCY" ? "Target (₹, before GST)" : def.unit === "PIECES" ? "Target (pieces)" : "Target (number)"} htmlFor="tg-value" required>
        <input id="tg-value" type="number" required min={0} step={def.unit === "CURRENCY" ? "0.01" : "1"} value={value} onChange={(e) => setValue(e.target.value)} className={textInputClass()} />
      </FormField>
      <FormField label="Notes" htmlFor="tg-notes">
        <input id="tg-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} />
      </FormField>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} />
        Submit for approval now (someone else approves it)
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" isLoading={busy} loadingLabel="Saving…">
          Create target
        </Button>
      </div>
    </form>
  );
}

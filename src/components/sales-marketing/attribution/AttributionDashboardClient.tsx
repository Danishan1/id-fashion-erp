"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDateTime } from "@/lib/date-format";
import { CHANNEL_TYPES, CONVERSION_TYPES, REVENUE_BASES, TOUCHPOINT_TYPES, type ConversionType, type RevenueBasis, type TouchpointType } from "@/modules/sales-marketing/attribution/attribution-registry";
import { CARD, RatioCell, fmtCredit, inr, rulesSummary, send, useApi, type Rules } from "./attribution-ui";

type Ratio = { value: number | null; status: string };
interface Row {
  campaignId: string;
  code: string;
  name: string;
  messagesSent: number;
  messagesDelivered: number;
  campaignResponses: number;
  credited: Record<ConversionType, number>;
  revenue: number;
  actualSpend: number;
  committed: number;
  costPerLead: number | null;
  costPerOrder: number | null;
  roi: Ratio;
  roas: Ratio;
  compare: { credited: number; revenue: number } | null;
}
export interface AttributionReport {
  models: { id: string; code: string; name: string; status: string; isDefault: boolean }[];
  sync: { source: string; lastSyncAt: string | null }[];
  basis: RevenueBasis;
  basisLabel: string;
  basisHelp: string;
  model: { id: string; code: string; name: string; status: string; version: number | null; rules: Rules | null } | null;
  run: { id: string; from: string; to: string; finishedAt: string | null; dataCut: string | null; trigger: string } | null;
  period?: { from: string; to: string; partial: boolean } | null;
  rows: Row[];
  totals: { byType: Record<ConversionType, { attributed: number; unattributed: number; excluded: number }>; attributed: number; unattributed: number; excluded: number; coveragePercent: number | null; revenue: number; actualSpend: number; roi: Ratio; roas: Ratio } | null;
  channels: { channel: string | null; touchpointType: string; credited: number; revenue: number }[];
  compareModel?: { id: string; code: string; name: string; runId: string | null; runPeriod: string | null } | null;
  quality: { notices: string[]; noIdentity?: number; noValue?: number };
}

const select = `${textInputClass()} !w-auto`;
const newKey = () => `attr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Sales & Marketing → Attribution & ROI (Phase 13). */
export function AttributionDashboardClient({ canRecalculate, today }: { canRecalculate: boolean; today: string }) {
  const [modelId, setModelId] = useState("");
  const [compareModelId, setCompare] = useState("");
  const [basis, setBasis] = useState<RevenueBasis>("ORDER_VALUE");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const params = new URLSearchParams({ basis, ...(modelId ? { modelId } : {}), ...(compareModelId ? { compareModelId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const { data, error, reload } = useApi<AttributionReport>(`/api/v1/sales-marketing/attribution?${params}`);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  const drill = (id: string) => `/sales-marketing/attribution/campaigns/${id}?${new URLSearchParams({ ...(data.model ? { modelId: data.model.id } : {}), ...(data.period ? { from: data.period.from, to: data.period.to } : {}) })}`;

  async function recalculate() {
    if (!data?.model) return;
    setBusy(true);
    setMessage(null);
    const end = today;
    const start = new Date(Date.parse(`${end}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
    try {
      await send(`/api/v1/sales-marketing/attribution/models/${data.model.id}/runs`, "POST", { from: from || start, to: to && to <= end ? to : end, idempotencyKey: newKey() });
      setMessage("Recalculation queued. It reads new records first; refresh in a minute.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const t = data.totals;
  return (
    <div className="space-y-4">
      <section className={`${CARD} space-y-3`}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-zinc-500">Model</span>
            <select aria-label="Model" value={modelId || data.model?.id || ""} onChange={(e) => setModelId(e.target.value)} className={select}>
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code}){m.isDefault ? " · default" : ""}
                  {m.status === "RETIRED" ? " · retired" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-zinc-500">Compare with</span>
            <select aria-label="Compare with" value={compareModelId} onChange={(e) => setCompare(e.target.value)} className={select}>
              <option value="">—</option>
              {data.models.filter((m) => m.id !== data.model?.id).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-zinc-500">Revenue basis</span>
            <select aria-label="Revenue basis" value={basis} onChange={(e) => setBasis(e.target.value as RevenueBasis)} className={select}>
              {(Object.keys(REVENUE_BASES) as RevenueBasis[]).map((k) => (
                <option key={k} value={k}>
                  {REVENUE_BASES[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-zinc-500">From</span>
            <input aria-label="From" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={select} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-zinc-500">To</span>
            <input aria-label="To" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={select} />
          </label>
          <div className="ml-auto flex gap-2">
            <Link href="/sales-marketing/attribution/models" className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              Models
            </Link>
            {canRecalculate && data.model && data.model.status === "ACTIVE" && (
              <Button size="sm" isLoading={busy} onClick={recalculate}>
                Recalculate
              </Button>
            )}
          </div>
        </div>
        {message && <p className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p>}
        {data.model?.rules && (
          <p className="text-xs text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {data.model.code} v{data.model.version}:
            </span>{" "}
            {rulesSummary(data.model.rules)}
          </p>
        )}
        {data.run && (
          <p className="text-xs text-zinc-500">
            Run {data.run.from} – {data.run.to}, finished {data.run.finishedAt ? formatDateTime(data.run.finishedAt) : "—"}
            {data.run.dataCut ? ` · records read up to ${formatDateTime(data.run.dataCut)}` : ""} · {data.run.trigger === "SCHEDULED" ? "nightly" : "requested"}
            {data.period ? ` · showing ${data.period.from} – ${data.period.to}` : ""}
          </p>
        )}
        <p className="text-xs text-zinc-500">{data.basisLabel}: {data.basisHelp}</p>
      </section>

      {data.quality.notices.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {data.quality.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {t && (
        <section className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Conversions credited", String(t.attributed)],
            ["Unattributed", String(t.unattributed)],
            ["Coverage", t.coveragePercent === null ? "—" : `${t.coveragePercent}%`],
            ["Attributed revenue", inr(t.revenue)],
            ["Actual spend", inr(t.actualSpend)],
            ["ROI (revenue-based)", t.roi.value === null ? "n/a" : `${t.roi.value}%`],
          ].map(([k, v]) => (
            <div key={k} className={CARD}>
              <div className="text-xs text-zinc-500">{k}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </section>
      )}

      {t && (
        <section className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-1.5 pr-3 font-medium">Conversion</th>
                <th className="py-1.5 pr-3 text-right font-medium">Credited</th>
                <th className="py-1.5 pr-3 text-right font-medium">Unattributed</th>
                <th className="py-1.5 text-right font-medium">Excluded (reversed)</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(CONVERSION_TYPES) as ConversionType[]).map((k) => (
                <tr key={k} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-1.5 pr-3">{CONVERSION_TYPES[k].label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{t.byType[k].attributed}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{t.byType[k].unattributed}</td>
                  <td className="py-1.5 text-right tabular-nums">{t.byType[k].excluded}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-zinc-500">Unattributed = no eligible touch in the window — never given to a campaign by default. Excluded = reversed (e.g. order cancelled).</p>
        </section>
      )}

      {data.run && (
        <section className={`${CARD} space-y-2`}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Campaigns</h2>
          {data.rows.length === 0 ? (
            <p className="text-sm text-zinc-500">No campaign you can see got credit in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                    <th className="py-1.5 pr-3 font-medium">Campaign</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Delivered / tagged</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Leads</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Enquiries</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Accepted quotes</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Orders</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Revenue</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Actual spend</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Cost / order</th>
                    <th className="py-1.5 pr-3 text-right font-medium">ROI</th>
                    <th className="py-1.5 pr-3 text-right font-medium">ROAS</th>
                    {data.compareModel && <th className="py-1.5 text-right font-medium">{data.compareModel.code}: credit / revenue</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.campaignId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="py-1.5 pr-3">
                        <Link href={drill(r.campaignId)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                          {r.code}
                        </Link>
                        <div className="text-xs text-zinc-500">{r.name}</div>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {r.messagesDelivered} / {r.campaignResponses}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCredit(r.credited.LEAD_CREATED)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCredit(r.credited.ENQUIRY_CREATED)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCredit(r.credited.QUOTATION_ACCEPTED)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCredit(r.credited.SALES_ORDER_BOOKED)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{inr(r.revenue)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {inr(r.actualSpend)}
                        {r.committed > 0 && <div className="text-xs text-zinc-500">+{inr(r.committed)} committed</div>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.costPerOrder === null ? <span className="text-zinc-400">n/a</span> : inr(r.costPerOrder)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        <RatioCell r={r.roi} suffix="%" />
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        <RatioCell r={r.roas} />
                      </td>
                      {data.compareModel && (
                        <td className="py-1.5 text-right tabular-nums">
                          {r.compare ? `${fmtCredit(r.compare.credited)} / ${inr(r.compare.revenue)}` : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-zinc-500">
            Conversion columns are credit, not counts: a conversion shared by two campaigns gives each a part. Revenue = {data.basisLabel.toLowerCase()} credited to the campaign. Actual spend = approved expenses + posted purchase invoices dated in the period (Phase 12);
            budgets and commitments aren&apos;t spend. ROI = (revenue − spend) ÷ spend, revenue-based — not profit. Attribution shares credit by a rule; it doesn&apos;t prove a campaign caused a sale.
          </p>
        </section>
      )}

      {data.channels.length > 0 && (
        <section className={`${CARD} space-y-2`}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">By channel ({REVENUE_BASES[data.basis].conversion === "QUOTATION_ACCEPTED" ? "accepted quotes" : "orders"})</h2>
          <table className="w-full text-sm">
            <tbody>
              {data.channels.map((c, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-1.5 pr-3">{c.channel ? CHANNEL_TYPES[c.channel as keyof typeof CHANNEL_TYPES] ?? c.channel : "Campaign set on a record"}</td>
                  <td className="py-1.5 pr-3 text-zinc-500">{TOUCHPOINT_TYPES[c.touchpointType as TouchpointType]?.label ?? c.touchpointType}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCredit(c.credited)}</td>
                  <td className="py-1.5 text-right tabular-nums">{inr(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-zinc-500">Costs aren&apos;t split by channel — Phase 12 spend is recorded per campaign.</p>
        </section>
      )}

      <section className={`${CARD} text-xs text-zinc-500`}>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Sources last read: </span>
        {data.sync.map((s) => `${s.source.toLowerCase().replace(/_/g, " ")} ${s.lastSyncAt ? formatDateTime(s.lastSyncAt) : "never"}`).join(" · ")}
      </section>
    </div>
  );
}

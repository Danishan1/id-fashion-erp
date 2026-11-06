"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { textInputClass } from "@/components/ui/FormField";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import type { DashboardWidget } from "@/modules/sales-marketing/analytics/analytics-dashboards";
import { AnalyticsChart } from "./AnalyticsChart";
import { ReportBuilder } from "./ReportBuilder";
import { ResultView } from "./ResultView";
import { AN_API, Badge, CARD, ChangeChip, FreshnessBadges, formatValue, metricColumns, send, useApi, type Catalog, type ReportResult, type SavedDefinition, type SavedReport } from "./analytics-ui";

export type AnalyticsTab = "dashboards" | "builder" | "saved" | "deliveries" | "glossary" | "usage";

/** Phase 17 — Sales & Marketing → Analytics. */
export function SmAnalyticsClient({ initialTab = "dashboards", initialReportId = null, initialQuery = null }: { initialTab?: AnalyticsTab; initialReportId?: string | null; initialQuery?: SavedDefinition["query"] | null }) {
  const cat = useApi<Catalog>(`${AN_API}/catalog`);
  const [tab, setTab] = useState<AnalyticsTab>(initialTab);
  const [editing, setEditing] = useState<SavedReport | null>(null);
  if (cat.error) return <ErrorState message={cat.error} onRetry={cat.reload} />;
  if (!cat.data) return <LoadingState />;
  const catalog = cat.data;
  const tabs: [AnalyticsTab, string][] = [
    ["dashboards", "Dashboards"],
    ["builder", editing ? `Edit: ${editing.name}` : "Report builder"],
    ["saved", "Saved reports"],
    ["deliveries", "Deliveries"],
    ["glossary", "Metric glossary"],
    ...(catalog.can.admin ? ([["usage", "Usage"]] as [AnalyticsTab, string][]) : []),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Analytics view">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => {
              if (k === "builder" && tab !== "builder") setEditing(null);
              setTab(k);
            }}
            className={`rounded px-3 py-1 text-sm font-medium ${tab === k ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "dashboards" && <DashboardsPanel catalog={catalog} />}
      {tab === "builder" && <ReportBuilder key={editing?.id ?? "new"} catalog={catalog} initial={editing} initialQuery={editing ? null : initialQuery} onSaved={() => (setEditing(null), setTab("saved"))} />}
      {tab === "saved" && (
        <SavedReportsPanel
          catalog={catalog}
          initialOpenId={initialReportId}
          onEdit={(r) => {
            setEditing(r);
            setTab("builder");
          }}
        />
      )}
      {tab === "deliveries" && <DeliveriesPanel />}
      {tab === "glossary" && <GlossaryPanel catalog={catalog} />}
      {tab === "usage" && <UsagePanel />}
    </div>
  );
}

// ── Dashboards ─────────────────────────────────────────────────────

type WidgetOutcome = { id: string; status: "OK"; result: ReportResult } | { id: string; status: "HIDDEN" | "ERROR"; message: string };
interface DashboardDto {
  dashboard: { key: string; label: string; description: string };
  preset: string;
  presetLabel: string;
  period: { from: string; to: string };
  widgets: (DashboardWidget & { outcome: WidgetOutcome })[];
}

function DashboardsPanel({ catalog }: { catalog: Catalog }) {
  const [key, setKey] = useState(catalog.dashboards[0]?.key ?? "executive");
  const [preset, setPreset] = useState<string>("");
  const dash = useApi<DashboardDto>(`${AN_API}/dashboards/${key}${preset ? `?preset=${preset}` : ""}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {catalog.dashboards.map((d) => (
          <Button key={d.key} size="xs" variant={d.key === key ? "primary" : "secondary"} onClick={() => (setKey(d.key), setPreset(""))}>
            {d.label}
          </Button>
        ))}
        <select aria-label="Dashboard period" className={`${textInputClass()} ml-auto w-auto`} value={preset || dash.data?.preset || ""} onChange={(e) => setPreset(e.target.value)}>
          {Object.entries(catalog.presets).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {dash.error && <ErrorState message={dash.error} onRetry={dash.reload} />}
      {!dash.data && !dash.error && <LoadingState label="Running the dashboard…" />}
      {dash.data && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {dash.data.dashboard.description} {dash.data.presetLabel}: {dash.data.period.from} to {dash.data.period.to}. Everything is shown with your own access.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {dash.data.widgets.map((w) => (
              <div key={w.id} className={`${CARD} ${w.span === 4 ? "md:col-span-2 xl:col-span-4" : w.span === 2 ? "md:col-span-2" : ""}`}>
                <div className="mb-2 text-sm font-medium">{w.title}</div>
                <Widget w={w} catalog={catalog} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Widget({ w, catalog }: { w: DashboardWidget & { outcome: WidgetOutcome }; catalog: Catalog }) {
  const o = w.outcome;
  if (o.status !== "OK") return o.status === "HIDDEN" ? <p className="text-xs text-zinc-500">Not available to you. {o.message}</p> : <p className="text-xs text-red-600">{o.message}</p>;
  const r = o.result;
  if (w.kind === "kpi") {
    const m = metricColumns(r)[0];
    if (!m) return <p className="text-xs text-zinc-500">Not available to you.</p>;
    const def = catalog.datasets.flatMap((d) => d.metrics).find((x) => x.id === m.key);
    const fresh = r.meta.freshness.find((f) => f.status !== "CURRENT");
    return (
      <div title={def?.description}>
        <div className="text-2xl font-semibold tabular-nums">{formatValue(r.totals.values[m.key], m.unit)}</div>
        {r.meta.comparePeriod && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>was {formatValue(r.totals.compare?.[m.key], m.unit)}</span>
            <ChangeChip change={r.totals.change?.[m.key]} higherIsBetter={def?.higherIsBetter} />
          </div>
        )}
        {fresh && (
          <div className="mt-1">
            <Badge tone="amber">{fresh.label}</Badge>
          </div>
        )}
      </div>
    );
  }
  if (w.kind === "table") return <ResultView result={r} catalog={catalog} showChart={false} />;
  return (
    <div className="space-y-2">
      <AnalyticsChart result={r} kind={w.kind === "funnel" ? "funnel" : w.kind === "line" ? "line" : "bar"} />
      {r.meta.freshness.some((f) => f.status !== "CURRENT") && <FreshnessBadges result={r} />}
    </div>
  );
}

// ── Saved reports ─────────────────────────────────────────────────

interface ScheduleDto {
  id: string;
  name: string;
  when: string;
  status: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastMessage: string | null;
  version: number;
}

function SavedReportsPanel({ catalog, onEdit, initialOpenId }: { catalog: Catalog; onEdit: (r: SavedReport) => void; initialOpenId: string | null }) {
  const list = useApi<SavedReport[]>(`${AN_API}/reports`);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data) return <LoadingState />;
  if (openId) return <SavedReportView id={openId} catalog={catalog} onBack={() => (setOpenId(null), list.reload())} onEdit={onEdit} />;
  if (!list.data.length) return <p className={`${CARD} text-sm text-zinc-500`}>No saved reports yet. Build one in the Report builder and save it.</p>;
  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500">
            <th className="py-1.5">Report</th>
            <th className="py-1.5">Data</th>
            <th className="py-1.5">Owner</th>
            <th className="py-1.5">Shared</th>
            <th className="py-1.5">Recipients</th>
            <th className="py-1.5">Updated</th>
          </tr>
        </thead>
        <tbody>
          {list.data.map((r) => (
            <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">
                <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpenId(r.id)}>
                  {r.name}
                </button>
                {r.description && <div className="text-xs text-zinc-500">{r.description}</div>}
              </td>
              <td className="py-1.5">{catalog.datasets.find((d) => d.key === r.definition.query.dataset)?.label ?? r.definition.query.dataset}</td>
              <td className="py-1.5">{r.isMine ? "You" : r.owner.name}</td>
              <td className="py-1.5">
                <Badge tone={r.sharing === "PRIVATE" ? "zinc" : "indigo"}>{r.sharingLabel}</Badge>
              </td>
              <td className="py-1.5">{r.recipients.length || "—"}</td>
              <td className="py-1.5">
                <ClientDateTime value={r.updatedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavedReportView({ id, catalog, onBack, onEdit }: { id: string; catalog: Catalog; onBack: () => void; onEdit: (r: SavedReport) => void }) {
  const rep = useApi<SavedReport>(`${AN_API}/reports/${id}`);
  const [run, setRun] = useState<ReportResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const schedules = useApi<ScheduleDto[]>(rep.data?.isMine ? `${AN_API}/reports/${id}/schedules` : null);
  const [rule, setRule] = useState({ frequency: "WEEKLY", timeOfDay: "08:15", dayOfWeek: "1", dayOfMonth: "1" });
  if (rep.error) return <ErrorState message={rep.error} onRetry={rep.reload} />;
  if (!rep.data) return <LoadingState />;
  const r = rep.data;
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runIt = () => act(async () => setRun((await send<{ result: ReportResult }>(`${AN_API}/reports/${id}/run`, "POST")).result));
  return (
    <div className="space-y-3">
      <div className={`${CARD} space-y-2`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={onBack}>
              ← Saved reports
            </button>
            <h2 className="text-lg font-semibold">{r.name}</h2>
            {r.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{r.description}</p>}
            <p className="text-xs text-zinc-500">
              {r.isMine ? "Yours" : `Shared by ${r.owner.name}`} · {r.sharingLabel} · version {r.version} ·{" "}
              {r.definition.period.mode === "relative" ? (catalog.presets[r.definition.period.preset] ?? r.definition.period.preset) : `${r.definition.query.from} to ${r.definition.query.to}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="xs" onClick={runIt} disabled={busy}>
              Run
            </Button>
            {r.isMine && (
              <Button size="xs" variant="secondary" onClick={() => onEdit(r)}>
                Edit
              </Button>
            )}
            {r.isMine && catalog.can.edit && r.recipients.length > 0 && (
              <Button size="xs" variant="secondary" disabled={busy} onClick={() => act(async () => {
                const s = await send<{ delivered: number; skipped: number; failed: number }>(`${AN_API}/reports/${id}/send`, "POST");
                setMsg(`Sent: ${s.delivered} delivered, ${s.skipped} skipped, ${s.failed} failed. See Deliveries for details.`);
              })}>
                Send now
              </Button>
            )}
            {r.isMine && (
              <Button size="xs" variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
        {msg && <p className="text-sm text-zinc-700 dark:text-zinc-300">{msg}</p>}
        {r.recipients.length > 0 && <p className="text-xs text-zinc-500">Recipients: {r.recipients.map((x) => x.name).join(", ")} · {r.deliveryFormat === "CSV" ? "CSV" : "Excel"}</p>}
        {r.isMine && catalog.can.edit && r.recipients.length > 0 && (
          <div className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <div className="text-sm font-medium">Delivery schedule</div>
            {schedules.data?.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={s.status === "ACTIVE" ? "green" : "amber"}>{s.status}</Badge>
                <span>{s.when}</span>
                {s.nextRunAt && (
                  <span className="text-zinc-500">
                    next <ClientDateTime value={s.nextRunAt} />
                  </span>
                )}
                {s.lastMessage && <span className="text-zinc-500">last: {s.lastMessage}</span>}
                <Button size="xs" variant="secondary" onClick={() => act(async () => (await send(`/api/v1/bulk-schedules/${s.id}`, "POST", { action: s.status === "ACTIVE" ? "pause" : "resume", version: s.version }), schedules.reload()))}>
                  {s.status === "ACTIVE" ? "Pause" : "Resume"}
                </Button>
                <Button size="xs" variant="danger" onClick={() => act(async () => (await send(`/api/v1/bulk-schedules/${s.id}`, "POST", { action: "delete", version: s.version }), schedules.reload()))}>
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select aria-label="Frequency" className={`${textInputClass()} w-auto`} value={rule.frequency} onChange={(e) => setRule({ ...rule, frequency: e.target.value })}>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              {rule.frequency === "WEEKLY" && (
                <select aria-label="Day of week" className={`${textInputClass()} w-auto`} value={rule.dayOfWeek} onChange={(e) => setRule({ ...rule, dayOfWeek: e.target.value })}>
                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {rule.frequency === "MONTHLY" && <input aria-label="Day of month" type="number" min={1} max={28} className={`${textInputClass()} w-20`} value={rule.dayOfMonth} onChange={(e) => setRule({ ...rule, dayOfMonth: e.target.value })} />}
              <input aria-label="Time" type="time" className={`${textInputClass()} w-auto`} value={rule.timeOfDay} onChange={(e) => setRule({ ...rule, timeOfDay: e.target.value })} />
              <span className="text-zinc-500">India time</span>
              <Button
                size="xs"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await send(`${AN_API}/reports/${id}/schedules`, "POST", { frequency: rule.frequency, timeOfDay: rule.timeOfDay, dayOfWeek: rule.frequency === "WEEKLY" ? Number(rule.dayOfWeek) : null, dayOfMonth: rule.frequency === "MONTHLY" ? Number(rule.dayOfMonth) : null });
                    schedules.reload();
                  }, "Scheduled.")
                }
              >
                Add schedule
              </Button>
            </div>
          </div>
        )}
        {r.versions && r.versions.length > 1 && (
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">History ({r.versions.length} versions)</summary>
            <ul className="mt-1 space-y-0.5">
              {r.versions.map((v) => (
                <li key={v.version}>
                  v{v.version} “{v.name}” — {v.changedBy}, <ClientDateTime value={v.at} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {run && (
        <div className={CARD}>
          <ResultView result={run} catalog={catalog} />
        </div>
      )}
      <ConfirmModal
        open={confirmDelete}
        title="Delete saved report"
        message={`Delete "${r.name}"? People it was shared with lose it, and its delivery schedules stop.`}
        confirmLabel="Delete"
        isDangerous
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => act(async () => (await send(`${AN_API}/reports/${id}?version=${r.version}`, "DELETE"), setConfirmDelete(false), onBack()))}
      />
    </div>
  );
}

// ── Deliveries ────────────────────────────────────────────────────

interface DeliveriesDto {
  received: { id: string; reportName: string; status: string; reason: string | null; fileName: string | null; rowCount: number | null; createdAt: string; expiresAt: string | null; downloadable: boolean; downloadedAt: string | null }[];
  sent: { id: string; reportName: string; recipient: string; status: string; reason: string | null; createdAt: string }[];
}

const deliveryTone = (s: string) => (s === "DELIVERED" ? "green" : s === "SKIPPED" ? "amber" : "red");

function DeliveriesPanel() {
  const d = useApi<DeliveriesDto>(`${AN_API}/deliveries`);
  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return <LoadingState />;
  return (
    <div className="space-y-4">
      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold">Delivered to you</h3>
        {!d.data.received.length ? (
          <p className="text-sm text-zinc-500">Nothing delivered to you in the last 60 days.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {d.data.received.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Badge tone={deliveryTone(x.status)}>{x.status}</Badge>
                <span className="font-medium">{x.reportName}</span>
                <span className="text-xs text-zinc-500">
                  <ClientDateTime value={x.createdAt} />
                </span>
                {x.reason && <span className="text-xs text-zinc-500">{x.reason}</span>}
                {x.downloadable ? (
                  <a className="ml-auto text-xs text-indigo-600 hover:underline" href={`${AN_API}/deliveries/${x.id}/download`}>
                    Download ({x.rowCount ?? 0} rows) — until <ClientDateTime value={x.expiresAt!} />
                  </a>
                ) : (
                  x.status === "DELIVERED" && <span className="ml-auto text-xs text-zinc-400">Expired</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {d.data.sent.length > 0 && (
        <div className={CARD}>
          <h3 className="mb-2 text-sm font-semibold">Deliveries of your reports</h3>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {d.data.sent.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Badge tone={deliveryTone(x.status)}>{x.status}</Badge>
                <span>{x.reportName}</span>
                <span className="text-zinc-500">→ {x.recipient}</span>
                <span className="text-xs text-zinc-500">
                  <ClientDateTime value={x.createdAt} />
                </span>
                {x.reason && <span className="text-xs text-zinc-500">{x.reason}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">You see who received a copy and who was skipped — never the recipients&apos; files, which are prepared with their own access.</p>
        </div>
      )}
    </div>
  );
}

// ── Glossary ──────────────────────────────────────────────────────

function GlossaryPanel({ catalog }: { catalog: Catalog }) {
  const [q, setQ] = useState("");
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="space-y-3">
      <input aria-label="Search metrics" placeholder="Search metrics…" className={textInputClass()} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="text-xs text-zinc-500">
        Governed definitions: every report, dashboard and export uses exactly these. {catalog.currency} Dates are {catalog.timezone}.
      </p>
      {catalog.datasets.map((ds) => {
        const ms = ds.metrics.filter((m) => !q || match(m.label) || match(m.description) || match(m.id));
        if (!ms.length) return null;
        return (
          <div key={ds.key} className={CARD}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{ds.label}</h3>
              <span className="text-xs text-zinc-500">{ds.grain} · source: {ds.source}</span>
              {!ds.available && <Badge tone="zinc">No access</Badge>}
            </div>
            <dl className="space-y-2">
              {ms.map((m) => (
                <div key={m.id} className="text-sm">
                  <dt className="font-medium">
                    {m.label} <span className="text-xs font-normal text-zinc-400">{m.id} · v{m.version}</span>
                  </dt>
                  <dd className="text-zinc-600 dark:text-zinc-400">
                    {m.description} <span className="block text-xs">Formula: {m.formula}</span>
                    {m.limitations.length > 0 && <span className="block text-xs">Limits: {m.limitations.join(" ")}</span>}
                    {m.notToBeConfusedWith?.length ? <span className="block text-xs">Not the same as: {m.notToBeConfusedWith.join(", ")}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

// ── Usage (admins) ────────────────────────────────────────────────

function UsagePanel() {
  const u = useApi<{ since: string; slowThresholdMs: number; datasets: { dataset: string; runs: number; denied: number; failed: number; avgMs: number; maxMs: number; slow: number }[] }>(`${AN_API}/usage`);
  if (u.error) return <ErrorState message={u.error} onRetry={u.reload} />;
  if (!u.data) return <LoadingState />;
  return (
    <div className={CARD}>
      <p className="mb-2 text-xs text-zinc-500">Last 30 days. Slow = {u.data.slowThresholdMs / 1000} s or more. The log keeps usage and timing only — never report data.</p>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500">
            <th>Data</th>
            <th className="text-right">Runs</th>
            <th className="text-right">Slow</th>
            <th className="text-right">Denied</th>
            <th className="text-right">Failed</th>
            <th className="text-right">Avg</th>
            <th className="text-right">Max</th>
          </tr>
        </thead>
        <tbody>
          {u.data.datasets.map((d) => (
            <tr key={d.dataset} className="border-t border-zinc-100 dark:border-zinc-800">
              <td>{d.dataset}</td>
              <td className="text-right">{d.runs}</td>
              <td className="text-right">{d.slow}</td>
              <td className="text-right">{d.denied}</td>
              <td className={`text-right ${d.failed ? "text-red-600" : ""}`}>{d.failed}</td>
              <td className="text-right">{d.avgMs} ms</td>
              <td className="text-right">{d.maxMs} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

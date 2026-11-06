"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SM_WF_STATUSES } from "@/modules/sales-marketing/workflows/sm-workflow-registry";
import { Badge, CARD, SM_WF_API, SM_WF_PAGE, TRIGGER_SOURCE, WfStatusBadge, useApi, type DefinitionRow, type InstanceRow, type MetricsDto } from "./sm-workflow-ui";

type Tab = "definitions" | "instances";

/** Phase 15 — Sales & Marketing → Workflows: the workflow types (switch on / configure) and the running workflows. */
export function SmWorkflowsClient({ initialTab = "definitions", initialStatuses = [] }: { initialTab?: Tab; initialStatuses?: string[] }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const metrics = useApi<MetricsDto>(`${SM_WF_API}/metrics`);
  return (
    <div className="space-y-4">
      <MetricTiles m={metrics.data} />
      <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Workflows view">
        {(
          [
            ["definitions", "Workflows"],
            ["instances", "Running & history"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 text-sm font-medium ${tab === k ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "definitions" ? <DefinitionsList /> : <InstancesList initialStatuses={initialStatuses} />}
    </div>
  );
}

function Tile({ label, value, hint, alert }: { label: string; value: string | number; hint?: string; alert?: boolean }) {
  return (
    <div className={CARD}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${alert ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function MetricTiles({ m }: { m: MetricsDto | null }) {
  if (!m) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Running" value={m.running} />
      <Tile label="Waiting" value={m.waiting} hint={`${m.waitingApproval} on an approval`} />
      <Tile label="Needs attention" value={m.needsAttention} alert={m.needsAttention > 0} />
      <Tile label="Completed (30 days)" value={m.completed30d} hint={m.completionRate30d === null ? undefined : `${m.completionRate30d}% of finished`} />
      <Tile label="Avg. approval wait" value={m.avgApprovalWaitHours === null ? "—" : `${m.avgApprovalWaitHours} h`} hint={`${m.retries30d} retries in 30 days`} />
      <Tile
        label="Processing lag"
        value={m.overdueRuns ? `${m.overdueRuns} overdue` : "On time"}
        alert={m.overdueRuns > 0 || m.compensationFailed > 0}
        hint={`${m.eventLagSeconds === null ? "Events not read yet" : `Events read ${Math.round(m.eventLagSeconds / 60)} min ago`}${m.compensationFailed ? ` · ${m.compensationFailed} undo failed` : ""}`}
      />
    </div>
  );
}

function DefinitionsList() {
  const { data, error, reload } = useApi<DefinitionRow[]>(SM_WF_API);
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Each workflow follows records through the Sales &amp; Marketing processes you already use: it checks, gives people CRM tasks, sends reminders and escalations, and records what happened. People still approve, convert and launch — a workflow never does those for them.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.map((d) => (
          <Link key={d.key} href={`${SM_WF_PAGE}/definitions/${d.key}`} className={`${CARD} block hover:border-indigo-400`}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{d.name}</h3>
              <Badge tone={d.status === "ACTIVE" ? "green" : "zinc"}>{d.status === "ACTIVE" ? `On · v${d.activeVersion}` : "Off"}</Badge>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{d.description}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
              <span>{d.live} running</span>
              <span className={d.attention ? "font-medium text-red-600 dark:text-red-400" : ""}>{d.attention} need attention</span>
              <span>{d.completed} completed</span>
              {d.runAs && <span>Runs as {d.runAs}</span>}
              {d.hasDraft && d.status === "ACTIVE" && <span className="text-amber-700 dark:text-amber-300">Unpublished changes</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const PAGE_SIZE = 25;

function InstancesList({ initialStatuses }: { initialStatuses: string[] }) {
  const [statuses, setStatuses] = useState<string[]>(initialStatuses);
  const [workflowKey, setWorkflowKey] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const defs = useApi<DefinitionRow[]>(SM_WF_API);
  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (statuses.length) p.set("statuses", statuses.join(","));
    if (workflowKey) p.set("workflowKey", workflowKey);
    if (applied) p.set("search", applied);
    return `${SM_WF_API}/instances?${p}`;
  }, [statuses, workflowKey, applied, page]);
  const [list, setList] = useState<{ data: InstanceRow[]; meta: { totalCount: number; totalPages: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(url, { headers: { "x-toast": "off" } })
      .then(async (r) => {
        const body = await r.json();
        if (!alive) return;
        if (!r.ok) setError(body?.error?.message ?? "Couldn't load.");
        else {
          setError(null);
          setList({ data: body.data, meta: body.meta });
        }
      })
      .catch(() => alive && setError("Couldn't load. Check your connection."));
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const toggle = (s: string) => {
    setPage(1);
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };

  return (
    <div className="space-y-3">
      <div className={`${CARD} space-y-2`}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-zinc-500">Workflow</span>
            <select
              className={textInputClass()}
              value={workflowKey}
              onChange={(e) => {
                setPage(1);
                setWorkflowKey(e.target.value);
              }}
            >
              <option value="">All workflows</option>
              {(defs.data ?? []).map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setApplied(search.trim());
            }}
          >
            <label className="text-sm">
              <span className="block text-xs text-zinc-500">Record</span>
              <input className={textInputClass()} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Enquiry, quotation or campaign" aria-label="Search by record" />
            </label>
            <Button type="submit" size="sm" variant="secondary">
              Search
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Status filter">
          {Object.entries(SM_WF_STATUSES).map(([k, s]) => (
            <button
              key={k}
              type="button"
              aria-pressed={statuses.includes(k)}
              onClick={() => toggle(k)}
              className={`rounded-full border px-2 py-0.5 text-xs ${statuses.includes(k) ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {error && !list ? (
        <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
      ) : !list ? (
        <LoadingState />
      ) : list.data.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No workflows match. Workflows start when a switched-on workflow&apos;s event happens (or when someone starts one on a record).</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 font-medium">Record</th>
                  <th className="px-3 py-2 font-medium">Workflow</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Step</th>
                  <th className="px-3 py-2 font-medium">Next check</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((i) => (
                  <tr key={i.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">
                      <Link href={`${SM_WF_PAGE}/instances/${i.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {i.entityLabel ?? i.entityId.slice(0, 8)}
                      </Link>
                      <div className="text-xs text-zinc-500">{TRIGGER_SOURCE[i.triggerSource] ?? i.triggerSource}</div>
                    </td>
                    <td className="px-3 py-2">
                      {i.workflowName}
                      <div className="text-xs text-zinc-500">v{i.version}</div>
                    </td>
                    <td className="px-3 py-2">
                      <WfStatusBadge label={i.statusLabel} tone={i.statusTone} />
                      {i.outcomeLabel && <div className="mt-1 text-xs text-zinc-500">{i.outcomeLabel}</div>}
                      {i.errorMessage && ["NEEDS_ATTENTION", "FAILED", "RETRY_PENDING"].includes(i.status) && <div className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{i.errorMessage}</div>}
                    </td>
                    <td className="px-3 py-2">{i.currentStepLabel}</td>
                    <td className="px-3 py-2 text-xs">{i.nextRunAt && !["COMPLETED", "CANCELLED"].includes(i.status) ? <ClientDateTime value={i.nextRunAt} /> : "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      <ClientDateTime value={i.startedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">{list.meta.totalCount} workflows</span>
            <div className="flex gap-2">
              <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="xs" variant="secondary" disabled={page >= list.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

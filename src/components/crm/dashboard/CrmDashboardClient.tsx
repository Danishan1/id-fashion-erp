"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityDetailModal } from "@/components/crm/activities/ActivityDetail";
import { useActivityLookups } from "@/components/crm/activities/useActivityLookups";
import { crmRequest } from "@/components/crm/crm-api";
import { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { formatTime } from "@/lib/date-format";
import {
  DASHBOARD_RANGE_KEYS,
  DASHBOARD_RANGES,
  DASHBOARD_WIDGETS,
  DEFAULT_DASHBOARD_LAYOUT,
  resolveDashboardLayout,
  type DashboardLayout,
  type DashboardRangeKey,
  type DashboardWidgetKey,
} from "@/modules/crm/dashboard/dashboard-registry";
import { ActivityView, AttentionView, AutomationView, KpiGrid, LeadsView, MyWorkView, PipelineView, WidgetError, WidgetFrame, WidgetSkeleton } from "./DashboardWidgets";
import { QuickActions } from "./QuickActions";
import { DASHBOARD_API, type DashboardDto, type DashboardPermissions, type WidgetResult } from "./dashboard-types";

interface Filters {
  range: DashboardRangeKey;
  from: string;
  to: string;
  pipelineId: string;
  owner: string;
}

const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Phase 21 — the CRM operational dashboard. One request loads every visible
 * widget for the current filters (date range, pipeline, owner); a refresh or
 * filter change keeps the previous numbers on screen, dimmed, until the new
 * ones arrive, and an answer to an older request is never shown over a newer
 * one. Layout and default filters are per user (CRM preferences).
 */
export function CrmDashboardClient(props: { permissions: DashboardPermissions; currentUserId: string; userName: string | null }) {
  const prefs = useCrmPreferences("dashboard.");
  if (!prefs.loaded) return <WidgetSkeleton lines={3} />;
  return <DashboardBody {...props} prefs={prefs} />;
}

function greetingNow() {
  const hour = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 13));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function DashboardBody({ permissions, currentUserId, userName, prefs }: { permissions: DashboardPermissions; currentUserId: string; userName: string | null; prefs: ReturnType<typeof useCrmPreferences> }) {
  const layout = resolveDashboardLayout(prefs.prefs["dashboard.layout"]);
  // Start from the user's saved filters (a custom range is never saved).
  const [filters, setFilters] = useState<Filters>(() => {
    const saved = prefs.prefs["dashboard.filters"] ?? {};
    const t = todayIso();
    return { range: saved.range && saved.range !== "custom" ? saved.range : "30d", from: t, to: t, pipelineId: saved.pipelineId ?? "", owner: saved.owner ?? "all" };
  });
  const [greeting] = useState(greetingNow);
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [openedActivity, setOpenedActivity] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!permissions.viewAll) return;
    let live = true;
    fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => live && setUsers(((b.data ?? []) as { id: string; fullName: string; status?: string }[]).filter((u) => !u.status || u.status === "ACTIVE")))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [permissions.viewAll]);

  const visibleData = useMemo(() => layout.widgets.filter((w) => w.visible && w.key !== "quickActions").map((w) => w.key), [layout]);
  const widgetsParam = visibleData.join(",");

  const load = useCallback(async () => {
    // An incomplete or reversed custom range is shown as an error, never requested.
    if (filters.range === "custom" && (!filters.from || !filters.to || filters.from > filters.to)) return;
    const id = ++seq.current;
    setLoading(true);
    const params = new URLSearchParams({ range: filters.range, owner: filters.owner, widgets: widgetsParam || "kpis" });
    if (filters.range === "custom") {
      params.set("from", filters.from);
      params.set("to", filters.to);
    }
    if (filters.pipelineId) params.set("pipelineId", filters.pipelineId);
    const r = await crmRequest<DashboardDto>(`${DASHBOARD_API}?${params}`, { toast: "off" });
    if (id !== seq.current) return; // a newer request is on its way: never show stale numbers
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error.message);
  }, [filters, widgetsParam]);

  useEffect(() => {
    // Debounced so typing a custom date doesn't fire a request per keystroke.
    const t = setTimeout(() => void load(), filters.range === "custom" ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, filters.range]);

  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    // Presets are remembered as the user's default view; a custom range is a one-off.
    if (next.range !== "custom") prefs.setPreference("dashboard.filters", { range: next.range, pipelineId: next.pipelineId || null, owner: next.owner as "all" });
  };

  const saveLayout = (next: DashboardLayout) => prefs.setPreference("dashboard.layout", next);

  const rangeLabel = data?.filters.range.label ?? DASHBOARD_RANGES[filters.range];
  const widget = <T,>(key: DashboardWidgetKey) => data?.widgets[key as keyof DashboardDto["widgets"]] as WidgetResult<T> | undefined;
  const pipelineData = widget<{ pipelines: { id: string; name: string }[] }>("pipeline");
  const pipelines = pipelineData?.status === "ok" ? pipelineData.data.pipelines : [];
  const customInvalid = filters.range === "custom" && (!filters.from || !filters.to || filters.from > filters.to);

  const renderWidget = (key: DashboardWidgetKey) => {
    const meta = DASHBOARD_WIDGETS[key];
    if (key === "quickActions") {
      return (
        <WidgetFrame id={key} title={meta.label}>
          <QuickActions permissions={permissions} currentUserId={currentUserId} onChanged={() => void load()} />
        </WidgetFrame>
      );
    }
    const res = widget<never>(key);
    const body = !res ? (
      <WidgetSkeleton />
    ) : res.status === "error" ? (
      <WidgetError message={res.message} onRetry={() => void load()} />
    ) : key === "kpis" ? (
      <KpiGrid cards={(res.data as { cards: Parameters<typeof KpiGrid>[0]["cards"] }).cards} />
    ) : key === "pipeline" ? (
      <PipelineView data={res.data} rangeLabel={rangeLabel} />
    ) : key === "leads" ? (
      <LeadsView data={res.data} rangeLabel={rangeLabel} />
    ) : key === "attention" ? (
      <AttentionView data={res.data} />
    ) : key === "myWork" ? (
      <MyWorkView data={res.data} onOpen={setOpenedActivity} />
    ) : key === "activity" ? (
      <ActivityView data={res.data} />
    ) : (
      <AutomationView data={res.data} rangeLabel={rangeLabel} />
    );
    const subtitle =
      key === "pipeline" && data?.filters.pipelineName
        ? data.filters.pipelineName
        : key === "myWork" && res?.status === "ok" && (res.data as { forUser: string | null }).forUser
          ? `For ${(res.data as { forUser: string }).forUser}`
          : key === "activity" && res?.status === "ok"
            ? rangeLabel
            : undefined;
    const action =
      key === "activity" && res?.status === "ok" ? (
        <a href={(res.data as { href: string }).href} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          Activity log →
        </a>
      ) : undefined;
    return (
      <WidgetFrame id={key} title={meta.label} subtitle={subtitle} action={action}>
        {body}
      </WidgetFrame>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">CRM Dashboard</h1>
          <p className="text-sm text-zinc-500">
            {greeting}
            {userName ? `, ${userName.split(" ")[0]}` : ""}. Your pipeline, leads and follow-ups in one place.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCustomizing(true)}>
          Customize
        </Button>
      </div>

      {/* One filter row; every widget below uses the same filters. */}
      <div role="group" aria-label="Dashboard filters" className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <label className="text-xs text-zinc-500">
          Period
          <select className={`${textInputClass()} mt-0.5 block w-auto`} value={filters.range} onChange={(e) => update({ range: e.target.value as DashboardRangeKey })}>
            {DASHBOARD_RANGE_KEYS.map((k) => (
              <option key={k} value={k}>
                {DASHBOARD_RANGES[k]}
              </option>
            ))}
          </select>
        </label>
        {filters.range === "custom" && (
          <>
            <label className="text-xs text-zinc-500">
              From
              <input type="date" className={`${textInputClass(customInvalid)} mt-0.5 block w-auto`} value={filters.from} max={filters.to} onChange={(e) => update({ from: e.target.value })} />
            </label>
            <label className="text-xs text-zinc-500">
              To
              <input type="date" className={`${textInputClass(customInvalid)} mt-0.5 block w-auto`} value={filters.to} min={filters.from} onChange={(e) => update({ to: e.target.value })} />
            </label>
          </>
        )}
        {pipelines.length > 1 && (
          <label className="text-xs text-zinc-500">
            Pipeline
            <select className={`${textInputClass()} mt-0.5 block w-auto`} value={filters.pipelineId || data?.filters.pipelineId || ""} onChange={(e) => update({ pipelineId: e.target.value })}>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-zinc-500">
          Owner
          <select className={`${textInputClass()} mt-0.5 block w-auto`} value={filters.owner} onChange={(e) => update({ owner: e.target.value })}>
            <option value="all">{permissions.viewAll ? "Everyone" : "All my records"}</option>
            <option value="me">Owned by me</option>
            {permissions.viewAll &&
              users
                .filter((u) => u.id !== currentUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span aria-live="polite">
            {loading ? "Updating…" : data ? (
              <>
                Updated {formatTime(data.generatedAt)} · {data.filters.range.from === data.filters.range.to ? data.filters.range.from : `${data.filters.range.from} – ${data.filters.range.to}`} · IST
              </>
            ) : null}
          </span>
          <Button size="xs" variant="secondary" onClick={() => void load()} disabled={loading || customInvalid}>
            Refresh
          </Button>
        </div>
      </div>

      {customInvalid && <p className="text-sm text-red-600 dark:text-red-400">Choose a start date on or before the end date.</p>}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span>{error}</span>
          <Button size="xs" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {layout.widgets.every((w) => !w.visible) ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          All widgets are hidden.{" "}
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setCustomizing(true)}>
            Customize the dashboard
          </button>
        </p>
      ) : (
        <div className={`grid gap-4 lg:grid-cols-2 ${loading && data ? "opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
          {layout.widgets
            .filter((w) => w.visible)
            .map((w) => (
              <div key={w.key} className={w.size === "full" ? "lg:col-span-2" : undefined}>
                {renderWidget(w.key)}
              </div>
            ))}
        </div>
      )}

      {customizing && <CustomizePanel layout={layout} onChange={saveLayout} onClose={() => setCustomizing(false)} />}
      {openedActivity && <ActivityOpener id={openedActivity} canEdit={permissions.edit} onClose={() => setOpenedActivity(null)} onChanged={() => void load()} />}
    </div>
  );
}

function ActivityOpener({ id, canEdit, onClose, onChanged }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { meta, users } = useActivityLookups();
  if (!meta) return null;
  return <ActivityDetailModal activityId={id} meta={meta} users={users} canEdit={canEdit} onClose={onClose} onChanged={onChanged} />;
}

/** Show / hide, reorder and resize widgets; saved per user, "Reset" restores the default layout. */
export function CustomizePanel({ layout, onChange, onClose }: { layout: DashboardLayout; onChange: (l: DashboardLayout) => void; onClose: () => void }) {
  const w = layout.widgets;
  const set = (widgets: DashboardLayout["widgets"]) => onChange({ widgets });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= w.length) return;
    const next = [...w];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="customize-title" className="fixed inset-0 z-50 flex justify-end bg-black/30" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-4 shadow-xl dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="customize-title" className="text-base font-semibold">
            Customize dashboard
          </h2>
          <button type="button" onClick={onClose} className="rounded px-2 text-xl leading-none text-zinc-500 hover:text-zinc-900" aria-label="Close" autoFocus>
            ×
          </button>
        </div>
        <p className="mb-3 text-sm text-zinc-500">Choose which sections you see, their order and width. Changes are saved for you only.</p>
        <ol className="space-y-2">
          {w.map((item, i) => (
            <li key={item.key} className="flex items-center gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
              <input
                type="checkbox"
                id={`show-${item.key}`}
                checked={item.visible}
                onChange={(e) => set(w.map((x) => (x.key === item.key ? { ...x, visible: e.target.checked } : x)))}
              />
              <label htmlFor={`show-${item.key}`} className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{DASHBOARD_WIDGETS[item.key].label}</span>
                <span className="block truncate text-xs text-zinc-500">{DASHBOARD_WIDGETS[item.key].description}</span>
              </label>
              <select aria-label={`Width of ${DASHBOARD_WIDGETS[item.key].label}`} className={`${textInputClass()} w-auto py-1 text-xs`} value={item.size} onChange={(e) => set(w.map((x) => (x.key === item.key ? { ...x, size: e.target.value as "half" | "full" } : x)))}>
                <option value="half">Half</option>
                <option value="full">Full</option>
              </select>
              <button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label={`Move ${DASHBOARD_WIDGETS[item.key].label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="rounded px-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label={`Move ${DASHBOARD_WIDGETS[item.key].label} down`} disabled={i === w.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex justify-between gap-2">
          <Button variant="secondary" onClick={() => onChange(DEFAULT_DASHBOARD_LAYOUT)}>
            Reset to default
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

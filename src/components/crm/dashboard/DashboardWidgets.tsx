"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { formatNumber } from "@/lib/currency";
import { BarList, ColumnChart, MoneyList } from "./DashboardCharts";
import type { ActivityData, AttentionData, AutomationData, KpiCard, LeadRow, LeadsData, MyWorkData, PipelineData, WorkItem } from "./dashboard-types";

const linkCls = "text-sm font-medium text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded dark:text-indigo-400";

/** Card frame shared by every widget: title, optional actions, and its own loading / error / content state. */
export function WidgetFrame({ title, subtitle, action, children, id }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function WidgetSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded bg-zinc-100 dark:bg-zinc-800" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="font-medium underline">
        Try again
      </button>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-zinc-500">{children}</p>;
}

const SCOPE_LABEL = { now: "Now", period: "In period", next: "Next 7 days" } as const;

// ── KPIs ─────────────────────────────────────────────────────────

export function KpiGrid({ cards }: { cards: KpiCard[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <li key={c.key}>
          <Link
            href={c.href}
            className={`flex h-full flex-col rounded-lg border p-3 transition hover:border-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${c.tone === "warning" ? "border-amber-300 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/5" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            <span className="flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span>{c.label}</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800">{SCOPE_LABEL[c.scope]}</span>
            </span>
            <span className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {c.value !== null ? formatNumber(c.value) : null}
              {c.tone === "warning" && c.value ? (
                <span className="ml-1 align-middle text-sm" aria-label="needs attention">
                  ⚠
                </span>
              ) : null}
            </span>
            {c.money && (
              <span className={`${c.value === null ? "mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50" : "text-xs text-zinc-600 dark:text-zinc-400"}`}>
                <MoneyList values={c.money} empty={c.value === null ? "—" : ""} />
              </span>
            )}
            <span className="mt-auto pt-1 text-xs text-zinc-500">{c.hint}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ── Pipeline ─────────────────────────────────────────────────────

export function PipelineView({ data, rangeLabel }: { data: PipelineData; rangeLabel: string }) {
  if (!data.pipeline) return <Empty>No active pipeline. Create one in CRM settings.</Empty>;
  const totalOpen = data.stages.reduce((n, s) => n + s.count, 0);
  const o = data.outcomes;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs text-zinc-500">
          Open opportunities by stage (now) ·{" "}
          {data.openHref ? (
            <Link href={data.openHref} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {formatNumber(totalOpen)} open
            </Link>
          ) : (
            `${totalOpen} open`
          )}
        </p>
        {data.stages.length === 0 ? (
          <Empty>This pipeline has no active stages.</Empty>
        ) : (
          <BarList
            ariaLabel="Open opportunities by stage"
            valueLabel="open opportunities"
            rows={data.stages.map((s) => ({ key: s.id, label: s.probability !== null ? `${s.name} (${s.probability}%)` : s.name, value: s.count, href: s.href, sub: s.values.length ? <MoneyList values={s.values} /> : undefined }))}
          />
        )}
      </div>
      {o && (
        <div>
          <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={o.wonHref} className="hover:underline">
              <strong className="tabular-nums">{formatNumber(o.won)}</strong> won
            </Link>
            <Link href={o.lostHref} className="hover:underline">
              <strong className="tabular-nums">{formatNumber(o.lost)}</strong> lost
            </Link>
            {o.abandoned > 0 && <span>{formatNumber(o.abandoned)} abandoned</span>}
            <span className="text-zinc-500">Win rate {o.winRate !== null ? `${o.winRate}%` : "—"}</span>
          </div>
          <ColumnChart
            title={`Won and lost ${rangeLabel.toLowerCase()}, by close date`}
            unit={o.unit}
            points={o.points.map((p) => ({ bucket: p.bucket, values: [p.won, p.lost] }))}
            series={[
              { name: "Won", color: "blue" },
              { name: "Lost", color: "orange" },
            ]}
          />
        </div>
      )}
    </div>
  );
}

// ── Leads ────────────────────────────────────────────────────────

export function LeadsView({ data, rangeLabel }: { data: LeadsData; rangeLabel: string }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm">
          <Link href={data.createdHref} className="hover:underline">
            <strong className="tabular-nums">{formatNumber(data.createdTotal)}</strong> new leads
          </Link>{" "}
          <span className="text-zinc-500">{rangeLabel.toLowerCase()}</span>
        </p>
        <ColumnChart title="New leads per day" unit={data.unit} points={data.trend.map((t) => ({ bucket: t.bucket, values: [t.count] }))} series={[{ name: "New leads", color: "blue" }]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-zinc-500">By source ({rangeLabel.toLowerCase()})</h3>
          {data.bySource.length ? <BarList ariaLabel="New leads by source" valueLabel="leads" rows={data.bySource.slice(0, 8).map((s) => ({ key: s.id ?? "none", label: s.label, value: s.count, href: s.href }))} /> : <Empty>No new leads.</Empty>}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-zinc-500">By status (now, not archived)</h3>
          {data.byStatus.length ? <BarList ariaLabel="Leads by status" valueLabel="leads" rows={data.byStatus.map((s) => ({ key: s.id, label: s.label, value: s.count, href: s.href }))} /> : <Empty>No leads yet.</Empty>}
        </div>
      </div>
    </div>
  );
}

function LeadList({ rows, empty, meta }: { rows: LeadRow[]; empty: string; meta: (r: LeadRow) => ReactNode }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((r) => (
        <li key={r.id} className="py-1.5">
          <Link href={r.href} className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <span className="block truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50">{r.label}</span>
            <span className="block truncate text-xs text-zinc-500">
              {[r.sublabel, r.status, r.owner ?? "Unassigned"].filter(Boolean).join(" · ")} · {meta(r)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AttentionView({ data }: { data: AttentionData }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Never contacted", value: data.neverContacted.count, href: data.neverContacted.href },
          { label: "Follow-up passed", value: data.followUpPassed.count, href: data.followUpPassed.href },
          { label: "Follow-up today", value: data.followUpToday.count, href: data.followUpToday.href },
        ].map((x) => (
          <Link key={x.label} href={x.href} className="rounded-md border border-zinc-200 p-2 hover:border-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-800">
            <span className="block text-xl font-semibold tabular-nums">{formatNumber(x.value)}</span>
            <span className="text-xs text-zinc-500">{x.label}</span>
          </Link>
        ))}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-medium text-zinc-500">Follow-up date passed (oldest first)</h3>
        <LeadList rows={data.followUpPassed.rows} empty="No overdue follow-ups." meta={(r) => (r.nextFollowUpAt ? <>follow-up <ClientDateTime value={r.nextFollowUpAt} mode="date" /></> : "")} />
      </div>
      <div>
        <h3 className="mb-1 text-xs font-medium text-zinc-500">Never contacted (oldest first)</h3>
        <LeadList rows={data.neverContacted.rows} empty="Every open lead has been contacted." meta={(r) => <>created <ClientDateTime value={r.createdAt} mode="date" /></>} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-medium text-zinc-500">Recently updated</h3>
          <Link href={data.recentlyUpdated.href} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            All leads →
          </Link>
        </div>
        <LeadList rows={data.recentlyUpdated.rows} empty="No leads yet." meta={(r) => <>updated <ClientDateTime value={r.updatedAt} /></>} />
      </div>
    </div>
  );
}

// ── My work ──────────────────────────────────────────────────────

const PRIORITY_TONE: Record<string, "red" | "amber" | "neutral"> = { URGENT: "red", HIGH: "amber" };

function WorkList({ items, empty, onOpen, completed }: { items: WorkItem[]; empty: string; onOpen: (id: string) => void; completed?: boolean }) {
  if (!items.length) return <p className="py-1 text-xs text-zinc-500">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {items.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-2 py-1.5">
          <div className="min-w-0">
            <button type="button" onClick={() => onOpen(a.id)} className="block max-w-full truncate text-left text-sm font-medium text-zinc-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-zinc-50">
              {a.subject}
            </button>
            <span className="block truncate text-xs text-zinc-500">
              {a.typeLabel}
              {a.related && (
                <>
                  {" · "}
                  {a.related.href ? (
                    <Link href={a.related.href} className="hover:underline">
                      {a.related.label}
                    </Link>
                  ) : (
                    a.related.label
                  )}
                </>
              )}
              {a.assignee && ` · ${a.assignee}`}
            </span>
          </div>
          <div className="shrink-0 text-right text-xs text-zinc-500">
            {completed ? (a.completedAt ? <ClientDateTime value={a.completedAt} /> : "Done") : a.due?.date ? `${a.due.date}${a.due.time ? ` ${a.due.time}` : ""}` : "No due date"}
            {PRIORITY_TONE[a.priority] && (
              <span className="mt-0.5 block">
                <CrmBadge label={a.priority === "URGENT" ? "Urgent" : "High"} tone={PRIORITY_TONE[a.priority]} />
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MyWorkView({ data, onOpen }: { data: MyWorkData; onOpen: (id: string) => void }) {
  const sections: { key: string; title: string; count?: number; items: WorkItem[]; href: string; empty: string; tone?: "warning"; completed?: boolean }[] = [
    { key: "overdue", title: "Overdue", count: data.overdue.count, items: data.overdue.items, href: data.overdue.href, empty: "Nothing overdue.", tone: data.overdue.count ? "warning" : undefined },
    { key: "today", title: "Due today", count: data.today.count, items: data.today.items, href: data.today.href, empty: "Nothing else due today." },
    { key: "upcoming", title: "Next 7 days", count: data.upcoming.count, items: data.upcoming.items, href: data.upcoming.href, empty: "Nothing planned." },
    { key: "appointments", title: "Upcoming appointments", count: data.appointments.count, items: data.appointments.items, href: data.appointments.href, empty: "No appointments in the next 7 days." },
    { key: "completed", title: "Recently completed", items: data.completed.items, href: data.completed.href, empty: "Nothing completed yet.", completed: true },
  ];
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="mb-0.5 flex items-center justify-between">
            <h3 className={`text-xs font-medium ${s.tone === "warning" ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}>
              {s.tone === "warning" && <span aria-hidden>⚠ </span>}
              {s.title}
              {s.count !== undefined && <span className="tabular-nums"> ({formatNumber(s.count)})</span>}
            </h3>
            <Link href={s.href} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              View all →
            </Link>
          </div>
          <WorkList items={s.items} empty={s.empty} onOpen={onOpen} completed={s.completed} />
        </div>
      ))}
    </div>
  );
}

// ── Recent activity ──────────────────────────────────────────────

const CATEGORY_TONE: Record<string, "green" | "red" | "indigo" | "amber" | "neutral"> = { won: "green", converted: "green", created: "indigo", lost: "red", stage: "amber" };

export function ActivityView({ data }: { data: ActivityData }) {
  if (!data.events.length) return <Empty>No activity in this period.</Empty>;
  return (
    <ol className="space-y-2">
      {data.events.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-sm">
          <CrmBadge label={e.label} tone={CATEGORY_TONE[e.category] ?? "neutral"} />
          <div className="min-w-0 flex-1">
            {e.href ? (
              <Link href={e.href} className="block truncate text-zinc-900 hover:underline dark:text-zinc-50">
                {e.summary || e.entityLabel}
              </Link>
            ) : (
              <span className="block truncate">{e.summary || e.entityLabel}</span>
            )}
            <span className="text-xs text-zinc-500">
              {e.entityLabel} · {e.actor ?? "System"} · <ClientDateTime value={e.occurredAt} />
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Automation & integrations ────────────────────────────────────

function Stat({ label, value, href, warn }: { label: string; value: number; href?: string; warn?: boolean }) {
  const body = (
    <>
      <span className={`block text-lg font-semibold tabular-nums ${warn && value > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}>
        {warn && value > 0 && <span aria-label="problem">⚠ </span>}
        {formatNumber(value)}
      </span>
      <span className="text-xs text-zinc-500">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md border border-zinc-200 p-2 hover:border-indigo-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-800">
      {body}
    </Link>
  ) : (
    <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">{body}</div>
  );
}

export function AutomationView({ data, rangeLabel }: { data: AutomationData; rangeLabel: string }) {
  const w = data.workflows;
  const i = data.integrations;
  return (
    <div className="space-y-4">
      {w && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-medium text-zinc-500">Workflow runs started {rangeLabel.toLowerCase()}</h3>
            <Link href={w.href} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              Execution history →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Stat label="Completed" value={w.completed} />
            <Stat label="Failed" value={w.failed} href={w.failedHref} warn />
            <Stat label="Running / waiting now" value={w.activeNow} href={w.href} />
            <Stat label="Cancelled" value={w.cancelled} />
          </div>
          {w.recentFailures.length > 0 && (
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
              {w.recentFailures.map((f) => (
                <li key={f.id} className="py-1.5 text-sm">
                  <Link href={f.href} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {f.workflow}
                  </Link>
                  <span className="block truncate text-xs text-zinc-500">
                    {f.message}
                    {f.finishedAt && (
                      <>
                        {" · "}
                        <ClientDateTime value={f.finishedAt} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div>
        <h3 className="mb-1 text-xs font-medium text-zinc-500">Bulk jobs</h3>
        <div className="grid grid-cols-2 gap-2 text-center">
          <Stat label="In progress" value={data.bulk.active} href={data.bulk.href} />
          <Stat label={`Failed or with errors (${rangeLabel.toLowerCase()})`} value={data.bulk.problems} href={data.bulk.problemsHref} warn />
        </div>
      </div>
      {i && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">Integrations ({rangeLabel.toLowerCase()})</h3>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Stat label="Failed lead captures" value={i.failedLeadCaptures} href={i.capturesHref} warn />
            <Stat label="Captures flagged for review" value={i.flaggedLeadCaptures} href={i.capturesHref} />
            <Stat label="Messages not sent" value={i.failedMessages} href={i.messagesHref} warn />
            <Stat label="Paused channels (now)" value={i.pausedChannels} href={i.channelsHref} />
          </div>
        </div>
      )}
      {!w && <p className="text-xs text-zinc-500">Workflow and integration health is shown to users with CRM settings access.</p>}
    </div>
  );
}

export { linkCls };

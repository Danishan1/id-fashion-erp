"use client";

import Link from "next/link";
import { useState } from "react";
import { SmBulkActions, bulkFilterQuery } from "@/components/sales-marketing/bulk/SmBulkActions";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_KEYS, PRIORITY_LABELS, type CampaignPriorityKey } from "@/modules/sales-marketing/campaigns/campaign-registry";
import { selectClass } from "../performance/performance-ui";
import { CARD, StatusBadge, dateRange, inr, useApi, useCampaignLookups } from "./campaign-ui";

interface Mini {
  id: string;
  code: string;
  name: string;
  status: string;
  owner: string;
  plannedStartDate: string;
  plannedEndDate: string;
}
interface Overview {
  counts: Record<string, number>;
  awaitingApproval: number;
  startingSoon: Mini[];
  dueToStart: Mini[];
  pastPlannedEnd: Mini[];
  overdueActivities: number;
  missingInfo: (Mini & { missing: string[] })[];
  plannedBudgetOpen: number;
}
interface Row {
  id: string;
  code: string;
  name: string;
  status: string;
  type: string;
  objective: string;
  owner: string;
  department: string | null;
  channel: string | null;
  priority: CampaignPriorityKey;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedBudget: number | null;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function MiniList({ title, rows, extra }: { title: string; rows: Mini[]; extra?: (r: Mini) => string }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase text-zinc-500">{title}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.slice(0, 6).map((r) => (
          <li key={r.id}>
            <Link href={`/sales-marketing/campaigns/${r.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {r.code}
            </Link>{" "}
            {r.name} <span className="text-xs text-zinc-500">· {extra ? extra(r) : dateRange(r.plannedStartDate, r.plannedEndDate)}</span>
          </li>
        ))}
        {rows.length > 6 && <li className="text-xs text-zinc-500">and {rows.length - 6} more</li>}
      </ul>
    </div>
  );
}

/** Sales & Marketing → Campaigns: marketing overview and the campaign list (Phase 08). */
export function CampaignsClient() {
  const { data: o, error, reload } = useApi<Overview>("/api/v1/sales-marketing/campaigns/overview");
  const lookups = useCampaignLookups();
  const [status, setStatus] = useState("");
  const [typeId, setTypeId] = useState("");
  const [ownerUserId, setOwner] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const c = (k: string) => o?.counts[k] ?? 0;

  return (
    <div className="space-y-4">
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !o ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="In planning" value={c("DRAFT")} />
            <Tile label="Awaiting approval" value={o.awaitingApproval} hint={o.awaitingApproval > c("PENDING_APPROVAL") ? "incl. plan changes" : undefined} />
            <Tile label="Approved, not started" value={c("APPROVED")} />
            <Tile label="Active" value={c("ACTIVE")} />
            <Tile label="Paused" value={c("PAUSED")} />
            <Tile label="Completed" value={c("COMPLETED")} />
            <Tile label="Overdue activities" value={o.overdueActivities} hint="CRM tasks on open campaigns" />
          </div>
          {(o.dueToStart.length > 0 || o.pastPlannedEnd.length > 0 || o.startingSoon.length > 0 || o.missingInfo.length > 0) && (
            <div className={`${CARD} grid gap-4 md:grid-cols-2`}>
              <MiniList title="Approved and past their planned start — activate when running" rows={o.dueToStart} />
              <MiniList title="Running past the planned end" rows={o.pastPlannedEnd} />
              <MiniList title="Starting in the next 30 days" rows={o.startingSoon} />
              <MiniList title="Missing a target or budget" rows={o.missingInfo} extra={(r) => `no ${(r as Mini & { missing: string[] }).missing.join(" or ")}`} />
            </div>
          )}
          <p className="text-xs text-zinc-500">Planned budget of open campaigns: {inr(o.plannedBudgetOpen)} (company currency; planning figures, not spend).</p>
        </>
      )}

      <DataTable<Row>
        fetchUrl="/api/v1/sales-marketing/campaigns"
        searchPlaceholder="Search code or name…"
        rowHref={(r) => `/sales-marketing/campaigns/${r.id}`}
        extraParams={{ status, typeId, ownerUserId, from, to }}
        onSearchChange={setSearch}
        selection={{ selectedIds: selected, onChange: setSelected, label: (r) => r.code }}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
              <option value="">Any status</option>
              <option value="DRAFT,PENDING_APPROVAL,APPROVED,ACTIVE,PAUSED">Open</option>
              {CAMPAIGN_STATUS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CAMPAIGN_STATUSES[k].label}
                </option>
              ))}
            </select>
            <select aria-label="Type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={selectClass}>
              <option value="">Any type</option>
              {lookups.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select aria-label="Owner" value={ownerUserId} onChange={(e) => setOwner(e.target.value)} className={selectClass}>
              <option value="">Any owner</option>
              {lookups.owners.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <input aria-label="Planned from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass} />
            <input aria-label="Planned to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectClass} />
            <SmBulkActions entityType="CAMPAIGN" selectedIds={selected} filterQuery={bulkFilterQuery({ status, typeId, ownerUserId, from, to, search: search.trim() })} onDone={() => setSelected([])} />
          </div>
        }
        columns={[
          {
            key: "code",
            header: "Campaign",
            render: (r) => (
              <div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.name}</div>
                <div className="text-xs text-zinc-500">
                  {r.code} · {r.type}
                </div>
              </div>
            ),
          },
          { key: "objective", header: "Objective", render: (r) => r.objective },
          { key: "owner", header: "Owner", render: (r) => <span>{r.owner}{r.department ? <span className="block text-xs text-zinc-500">{r.department}</span> : null}</span> },
          {
            key: "plannedStartDate",
            header: "Dates",
            render: (r) => (
              <div className="whitespace-nowrap text-xs">
                <div>Planned {dateRange(r.plannedStartDate, r.plannedEndDate)}</div>
                {r.actualStartDate && <div className="text-zinc-500">Actual {dateRange(r.actualStartDate, r.actualEndDate ?? "…")}</div>}
              </div>
            ),
          },
          { key: "plannedBudget", header: "Planned budget", render: (r) => (r.plannedBudget === null ? <span className="text-zinc-400">—</span> : inr(r.plannedBudget)) },
          { key: "priority", header: "Priority", render: (r) => PRIORITY_LABELS[r.priority] },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
    </div>
  );
}

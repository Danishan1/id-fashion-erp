"use client";

import Link from "next/link";
import { useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CAMPAIGN_STATUSES, type CampaignStatusKey } from "@/modules/sales-marketing/campaigns/campaign-registry";
import { Badge, CARD, inr, useApi } from "../promotions/promotion-ui";
import { ALERT_LABELS, UsedBar } from "./budget-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  status: string;
  owner: string;
  start: string;
  end: string;
  approved: number | null;
  allocated: number;
  actual: number;
  committed: number;
  pipeline: number;
  remaining: number | null;
  usedPercent: number | null;
  openAlerts: string[];
}

export function BudgetOverviewClient() {
  const [status, setStatus] = useState("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(alertsOnly ? { alertsOnly: "1" } : {}), ...(q ? { search: q } : {}) });
  const { data, error, reload } = useApi<{ rows: Row[]; totals: Record<string, number> }>(`/api/v1/sales-marketing/budgets?${params}`);
  return (
    <div className={`${CARD} space-y-3`}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <input aria-label="Search" placeholder="Search campaign…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${textInputClass()} !w-64`} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${textInputClass()} !w-auto`}>
          <option value="">Approved, running, paused, completed</option>
          {(["APPROVED", "ACTIVE", "PAUSED", "COMPLETED"] as CampaignStatusKey[]).map((k) => (
            <option key={k} value={k}>
              {CAMPAIGN_STATUSES[k].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} /> With open alerts only
        </label>
      </form>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : data.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No campaigns match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="py-2 pr-3 text-right font-medium">Approved</th>
                <th className="py-2 pr-3 text-right font-medium">Allocated</th>
                <th className="py-2 pr-3 text-right font-medium">Actual</th>
                <th className="py-2 pr-3 text-right font-medium">Committed</th>
                <th className="py-2 pr-3 text-right font-medium">Remaining</th>
                <th className="w-40 py-2 pr-3 font-medium">Used</th>
                <th className="py-2 font-medium">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <Link href={`/sales-marketing/campaigns/${r.id}#budget`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {r.code}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      {r.name} · {CAMPAIGN_STATUSES[r.status as CampaignStatusKey]?.label ?? r.status} · {r.owner}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.approved === null ? <span className="text-zinc-400">Not approved</span> : inr(r.approved)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(r.allocated)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(r.actual)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {inr(r.committed)}
                    {r.pipeline > 0 && <div className="text-xs text-zinc-500">+{inr(r.pipeline)} pending</div>}
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${(r.remaining ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{r.remaining === null ? "—" : inr(r.remaining)}</td>
                  <td className="py-2 pr-3">
                    <UsedBar percent={r.usedPercent} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.openAlerts.map((a, i) => (
                        <Badge key={i} tone={a === "WARN_THRESHOLD" ? "amber" : "red"}>
                          {ALERT_LABELS[a] ?? a}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                <td className="py-2 pr-3">{data.rows.length} campaigns</td>
                <td className="py-2 pr-3 text-right tabular-nums">{inr(data.totals.approved)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{inr(data.totals.allocated)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{inr(data.totals.actual)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{inr(data.totals.committed)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Actual = approved / partly paid / paid expenses + posted purchase invoices (before GST). Committed = approved purchase orders minus what has been invoiced against them. Pending = expenses waiting for approval and draft orders / invoices — not counted yet. Remaining = approved − actual − committed. Not a measure of return.
      </p>
    </div>
  );
}

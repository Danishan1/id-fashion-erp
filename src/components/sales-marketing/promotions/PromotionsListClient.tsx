"use client";

import Link from "next/link";
import { useState } from "react";
import { SmBulkActions, bulkFilterQuery, toggleId } from "@/components/sales-marketing/bulk/SmBulkActions";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDate } from "@/lib/date-format";
import { APPLY_MODES, VERSION_STATUSES, type ApplyMode, type PromotionVersionStatus } from "@/modules/sales-marketing/promotions/promotion-registry";
import { Badge, CARD, DisplayStatusBadge, discountText, inr, useApi } from "./promotion-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  applyMode: string;
  displayStatus: string;
  owner: string;
  approvedVersion: { number: number; discountType: string; value: number; stacking: string; validFrom: string; validTo: string | null; maxRedemptions: number | null } | null;
  openVersion: { number: number; status: string } | null;
  usage: { reserved: number; redeemed: number; discountRedeemed: number };
}

const selectClass = `${textInputClass()} !w-auto min-w-[10rem]`;

/** Sales & Marketing → Promotions (Phase 12). */
export function PromotionsListClient() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { search: q } : {}) });
  const { data, error, reload } = useApi<Row[]>(`/api/v1/sales-marketing/promotions?${params}`);
  return (
    <div className={`${CARD} space-y-3`}>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <input aria-label="Search" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${textInputClass()} !w-64`} />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">All but archived</option>
          <option value="ACTIVE">On (running, scheduled or ended)</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="EXPIRED">Expired</option>
          <option value="DRAFT">Draft</option>
          <option value="PAUSED">Paused</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <div className="ml-auto">
          <SmBulkActions entityType="PROMOTION" selectedIds={selected} filterQuery={bulkFilterQuery({ status, search: q })} onDone={() => setSelected([])} />
        </div>
      </form>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No promotions here yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="w-8 py-2 pr-2">
                  <input type="checkbox" aria-label="Select all promotions shown" checked={data.length > 0 && data.every((r) => selected.includes(r.id))} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...data.map((r) => r.id)])] : selected.filter((id) => !data.some((r) => r.id === id)))} />
                </th>
                <th className="py-2 pr-3 font-medium">Promotion</th>
                <th className="py-2 pr-3 font-medium">Applies</th>
                <th className="py-2 pr-3 font-medium">Approved terms</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 text-right font-medium">Reserved</th>
                <th className="py-2 pr-3 text-right font-medium">Used</th>
                <th className="py-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Select ${r.code}`} checked={selected.includes(r.id)} onChange={(e) => setSelected(toggleId(selected, r.id, e.target.checked))} />
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/sales-marketing/promotions/${r.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {r.code}
                    </Link>
                    <div className="text-xs text-zinc-500">{r.name}</div>
                  </td>
                  <td className="py-2 pr-3">{APPLY_MODES[r.applyMode as ApplyMode]?.label ?? r.applyMode}</td>
                  <td className="py-2 pr-3">
                    {r.approvedVersion ? (
                      <>
                        <div>
                          v{r.approvedVersion.number} · {discountText(r.approvedVersion.discountType, r.approvedVersion.value)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {formatDate(r.approvedVersion.validFrom)} – {r.approvedVersion.validTo ? formatDate(r.approvedVersion.validTo) : "open"}
                          {r.approvedVersion.maxRedemptions ? ` · limit ${r.approvedVersion.maxRedemptions}` : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-zinc-400">Nothing approved yet</span>
                    )}
                    {r.openVersion && (
                      <div className="mt-1">
                        <Badge tone={r.openVersion.status === "PENDING_APPROVAL" ? "amber" : "zinc"}>
                          v{r.openVersion.number} {VERSION_STATUSES[r.openVersion.status as PromotionVersionStatus]?.label.toLowerCase()}
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <DisplayStatusBadge status={r.displayStatus} />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.usage.reserved}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.usage.redeemed}
                    {r.usage.redeemed > 0 && <div className="text-xs text-zinc-500">{inr(r.usage.discountRedeemed)}</div>}
                  </td>
                  <td className="py-2">{r.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-zinc-500">Reserved = on issued quotations that are still open; Used = turned into Sales Orders (with the discount given, before GST). Both count towards limits.</p>
    </div>
  );
}

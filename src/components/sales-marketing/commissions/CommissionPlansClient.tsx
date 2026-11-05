"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { selectClass } from "../performance/performance-ui";
import { BASIS_LABELS, Badge, CARD, PAYEE_LABELS, VERSION_STATUS, useApi } from "./commission-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  payeeType: "REP" | "AGENT";
  basis: "INVOICED" | "COLLECTED";
  active: boolean;
  inForce: { versionNumber: number; summary: string } | null;
  open: { versionNumber: number; status: keyof typeof VERSION_STATUS } | null;
  payeesNow: number;
}

/** Commissions → Plans list (Phase 07). */
export function CommissionPlansClient() {
  const [status, setStatus] = useState("active");
  const [payeeType, setPayeeType] = useState("");
  const { data, error, reload } = useApi<Row[]>(`/api/v1/sales-marketing/commissions/plans?status=${status}&payeeType=${payeeType}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <select aria-label="Paid to" value={payeeType} onChange={(e) => setPayeeType(e.target.value)} className={selectClass}>
          <option value="">Reps and agents</option>
          <option value="REP">Sales reps</option>
          <option value="AGENT">Sales agents</option>
        </select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm text-zinc-500">No commission plans. A plan sets how commission is worked out; assign it to reps or sales agents from its page.</p>
        </div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3">Paid to</th>
                <th className="py-2 pr-3">Basis</th>
                <th className="py-2 pr-3">Rule in force today</th>
                <th className="py-2 pr-3 text-right">Payees today</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <Link href={`/sales-marketing/commissions/plans/${p.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {p.name}
                    </Link>
                    <div className="text-xs text-zinc-500">{p.code}</div>
                  </td>
                  <td className="py-2 pr-3">{PAYEE_LABELS[p.payeeType]}</td>
                  <td className="py-2 pr-3">{BASIS_LABELS[p.basis]}</td>
                  <td className="py-2 pr-3">{p.inForce ? `v${p.inForce.versionNumber}: ${p.inForce.summary}` : <span className="text-zinc-400">No approved version in force</span>}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.payeesNow}</td>
                  <td className="py-2 space-x-1 whitespace-nowrap">
                    {p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                    {p.open && <Badge tone={VERSION_STATUS[p.open.status].tone}>{`v${p.open.versionNumber} ${VERSION_STATUS[p.open.status].label.toLowerCase()}`}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

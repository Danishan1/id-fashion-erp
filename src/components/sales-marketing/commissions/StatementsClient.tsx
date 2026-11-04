"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { selectClass } from "../performance/performance-ui";
import { Badge, CARD, PAYEE_LABELS, PAYMENT_TONE, STATEMENT_STATUS, monthLabel, send, signedInr, useApi } from "./commission-ui";

interface Row {
  id: string;
  month: string;
  payeeType: "REP" | "AGENT";
  payee: string;
  status: keyof typeof STATEMENT_STATUS;
  earned: number;
  reversals: number;
  incentives: number;
  adjustments: number;
  net: number;
  payment: { number: string; status: string; label: string } | null;
}
interface Calc {
  month: string;
  calculated: { payee: string; statementId: string; net: number; lines: number }[];
  skippedLocked: { payee: string; status: string }[];
  removedEmpty: number;
  notes: string[];
}

/** Commissions → Statements (Phase 07): calculate a month, then submit / approve each payee's statement. */
export function StatementsClient({ months, canCalculate, viewAll }: { months: string[]; canCalculate: boolean; viewAll: boolean }) {
  const [month, setMonth] = useState(months[1] ?? months[0]);
  const [status, setStatus] = useState("");
  const [payeeType, setPayeeType] = useState("");
  const { data, error, reload } = useApi<{ viewAll: boolean; rows: Row[] }>(`/api/v1/sales-marketing/commissions/statements?month=${month}&status=${status}&payeeType=${payeeType}`);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [busy, setBusy] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const totals = data?.rows.reduce((t, r) => ({ earned: t.earned + r.earned + r.incentives, net: t.net + r.net }), { earned: 0, net: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Month" value={month} onChange={(e) => (setMonth(e.target.value), setCalc(null))} className={selectClass}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
              {m === months[0] ? " (current)" : ""}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Any status</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Waiting for approval</option>
          <option value="APPROVED">Approved</option>
        </select>
        {viewAll && (
          <select aria-label="Payee" value={payeeType} onChange={(e) => setPayeeType(e.target.value)} className={selectClass}>
            <option value="">Reps and agents</option>
            <option value="REP">Sales reps</option>
            <option value="AGENT">Sales agents</option>
          </select>
        )}
        {canCalculate && (
          <Button
            isLoading={busy}
            loadingLabel="Calculating…"
            onClick={async () => {
              setBusy(true);
              setCalcError(null);
              try {
                setCalc(await send<Calc>("/api/v1/sales-marketing/commissions/statements/calculate", "POST", { month }));
                reload();
              } catch (err) {
                setCalcError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Calculate {monthLabel(month)}
          </Button>
        )}
      </div>
      {calcError && <p className="text-sm text-red-600 dark:text-red-400">{calcError}</p>}
      {calc && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40" role="status">
          {calc.calculated.length ? `Calculated ${calc.calculated.length} draft statement${calc.calculated.length === 1 ? "" : "s"} for ${monthLabel(calc.month)}.` : `Nothing to calculate for ${monthLabel(calc.month)}.`}
          {calc.removedEmpty > 0 && ` Removed ${calc.removedEmpty} draft${calc.removedEmpty === 1 ? "" : "s"} with nothing left on them.`}
          {calc.skippedLocked.length > 0 && ` Left alone (already submitted or approved): ${calc.skippedLocked.map((s) => s.payee).join(", ")} — new items go on next month's statement.`}
          {calc.notes.map((n) => (
            <span key={n} className="block text-xs text-zinc-600 dark:text-zinc-300">
              {n}
            </span>
          ))}
        </div>
      )}
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : data.rows.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm text-zinc-500">
            No statements for {monthLabel(month)}.{canCalculate ? " Calculate the month to work out commission from posted invoices / collections for everyone on a plan." : ""}
          </p>
        </div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Payee</th>
                <th className="py-2 pr-3 text-right">Commission</th>
                <th className="py-2 pr-3 text-right">Reversals</th>
                <th className="py-2 pr-3 text-right">Incentives</th>
                <th className="py-2 pr-3 text-right">Adjust. / carried</th>
                <th className="py-2 pr-3 text-right">Net</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Payment</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <Link href={`/sales-marketing/commissions/statements/${r.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {r.payee}
                    </Link>
                    <div className="text-xs text-zinc-500">{PAYEE_LABELS[r.payeeType]}</div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{signedInr(r.earned)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.reversals ? signedInr(r.reversals) : "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.incentives ? signedInr(r.incentives) : "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.adjustments ? signedInr(r.adjustments) : "—"}</td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">{signedInr(r.net)}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={STATEMENT_STATUS[r.status].tone}>{STATEMENT_STATUS[r.status].label}</Badge>
                  </td>
                  <td className="py-2">{r.payment ? <Badge tone={PAYMENT_TONE[r.payment.status] ?? "zinc"}>{r.payment.label}</Badge> : r.status === "APPROVED" && r.net < 0 ? <span className="text-xs text-zinc-500">To recover next month</span> : <span className="text-zinc-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
            {totals && data.rows.length > 1 && (
              <tfoot>
                <tr className="text-xs text-zinc-500">
                  <td className="pt-2" colSpan={5}>
                    {data.rows.length} statements · calculated, approved and paid amounts are shown separately and never mixed
                  </td>
                  <td className="pt-2 text-right font-medium tabular-nums">{signedInr(totals.net)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {!viewAll && <p className="text-xs text-zinc-500">You see your own statements.</p>}
    </div>
  );
}

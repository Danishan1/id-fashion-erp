"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/date-format";
import { Badge, CARD, LINE_KIND_LABELS, PAYEE_LABELS, PAYMENT_TONE, STATEMENT_STATUS, TextDialog, inr, monthLabel, send, signedInr, type TextDialogSpec } from "./commission-ui";

interface Line {
  id: string;
  kind: keyof typeof LINE_KIND_LABELS;
  eventKey: string;
  eventDate: string | null;
  basis: number | null;
  rate: number | null;
  amount: number;
  details: Record<string, unknown>;
  salesInvoiceId: string | null;
  salesOrderId: string | null;
  reason: string | null;
  createdBy: string | null;
}
export interface StatementView {
  id: string;
  month: string;
  payeeType: "REP" | "AGENT";
  payee: string;
  status: keyof typeof STATEMENT_STATUS;
  totals: { earned: number; reversals: number; incentives: number; adjustments: number; carryForward: number; net: number };
  calculatedAt: string;
  calculatedBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionComment: string | null;
  monthOver: boolean;
  payment: { id: string; number: string; status: string; label: string; amount: number; paid: number } | null;
  lines: Line[];
  can: { recalculate: boolean; adjust: boolean; submit: boolean; discard: boolean; returnToDraft: boolean; approve: boolean; sendBack: boolean; raisePayment: boolean };
}

const ACTIONS: Record<string, TextDialogSpec> = {
  submit: { action: "submit", title: "Submit for approval", help: "Lines are frozen once submitted. Someone other than whoever calculated or submitted it must approve.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Submit" },
  approve: { action: "approve", title: "Approve statement", help: "A positive net raises a Sales commission payment request in Accounts → Payment Requests. A negative net is carried to next month.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Approve" },
  "send-back": { action: "send-back", title: "Send back", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Send back", danger: true },
  "return-to-draft": { action: "return-to-draft", title: "Return to draft", submitLabel: "Return to draft" },
  "raise-payment": { action: "raise-payment", title: "Raise payment request", help: "Raises a Sales commission payment request for the net amount.", submitLabel: "Raise" },
  discard: { action: "discard", title: "Discard draft statement", help: "Its items are picked up again next time the month is calculated. Manual adjustments are lost.", submitLabel: "Discard", danger: true },
};

const d = (l: Line, k: string) => (l.details?.[k] as string | number | null | undefined) ?? null;

function describe(l: Line) {
  if (l.kind === "EARNING" || l.kind === "REVERSAL") {
    const parts = [`Invoice ${d(l, "invoiceNumber") ?? "—"}`, `order ${d(l, "orderNumber") ?? "—"}`];
    if (d(l, "paymentNumber")) parts.push(`payment ${d(l, "paymentNumber")}`);
    if (l.kind === "REVERSAL") parts.push(String(d(l, "why") ?? "source cancelled"));
    else if (d(l, "planCode")) parts.push(`plan ${d(l, "planCode")} v${d(l, "versionNumber")}`);
    return parts.join(" · ");
  }
  if (l.kind === "INCENTIVE") return `${d(l, "planCode")}: ${d(l, "metric")} ${d(l, "periodStart")} → ${d(l, "periodEnd")} · ${d(l, "attainment") ?? "—"}% of ${inr(Number(d(l, "target") ?? 0))}`;
  if (l.kind === "CARRY_FORWARD") return `Recovered from ${monthLabel(String(d(l, "fromPeriod")))}`;
  return `${l.reason ?? ""}${l.createdBy ? ` — ${l.createdBy}` : ""}`;
}

/** One payee's commission statement for a month (Phase 07). */
export function StatementDetailClient({ initial }: { initial: StatementView }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adj, setAdj] = useState({ amount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/sales-marketing/commissions/statements/${s.id}`;
  const st = STATEMENT_STATUS[s.status];

  // Group the commission lines by plan version so the tier maths shows once per group.
  const groups = new Map<string, { info: Record<string, unknown>; lines: Line[] }>();
  for (const l of s.lines.filter((x) => x.kind === "EARNING")) {
    const key = `${d(l, "planCode")}|${d(l, "versionNumber")}`;
    const g = groups.get(key) ?? { info: { planCode: d(l, "planCode"), versionNumber: d(l, "versionNumber"), rule: d(l, "rule"), ...((l.details.group as Record<string, unknown>) ?? {}) }, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  const others = s.lines.filter((x) => x.kind !== "EARNING");

  const act = async (fn: () => Promise<StatementView | { deleted: true }>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if ("deleted" in next) return router.push("/sales-marketing/commissions");
      setS(next);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm">
            <p>
              <Badge tone={st.tone}>{st.label}</Badge> <span className="text-zinc-600 dark:text-zinc-300">{PAYEE_LABELS[s.payeeType]} · {monthLabel(s.month)}</span>
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{signedInr(s.totals.net)}</p>
            <p className="text-xs text-zinc-500">
              Net = commission {signedInr(s.totals.earned)}
              {s.totals.reversals ? ` · reversals ${signedInr(s.totals.reversals)}` : ""}
              {s.totals.incentives ? ` · incentives ${signedInr(s.totals.incentives)}` : ""}
              {s.totals.carryForward ? ` · carried forward ${signedInr(s.totals.carryForward)}` : ""}
              {s.totals.adjustments ? ` · adjustments ${signedInr(s.totals.adjustments)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.can.recalculate && (
              <Button
                size="xs"
                variant="secondary"
                isLoading={busy}
                onClick={() =>
                  act(async () => {
                    await send("/api/v1/sales-marketing/commissions/statements/calculate", "POST", { month: s.month });
                    const r = await fetch(base, { headers: { "x-toast": "off" } });
                    if (r.status === 404) return { deleted: true as const };
                    return (await r.json()).data;
                  })
                }
              >
                Recalculate month
              </Button>
            )}
            {s.can.adjust && (
              <Button size="xs" variant="secondary" onClick={() => (setError(null), setAdj({ amount: "", reason: "" }), setAdjusting(true))}>
                Add adjustment
              </Button>
            )}
            {s.can.submit && (
              <Button size="xs" onClick={() => setDialog(ACTIONS.submit)}>
                Submit
              </Button>
            )}
            {s.can.approve && (
              <Button size="xs" variant="success" onClick={() => setDialog(ACTIONS.approve)}>
                Approve
              </Button>
            )}
            {s.can.sendBack && (
              <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS["send-back"])}>
                Send back
              </Button>
            )}
            {s.can.returnToDraft && (
              <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS["return-to-draft"])}>
                Return to draft
              </Button>
            )}
            {s.can.raisePayment && (
              <Button size="xs" onClick={() => setDialog(ACTIONS["raise-payment"])}>
                Raise payment request
              </Button>
            )}
            {s.can.discard && (
              <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS.discard)}>
                Discard
              </Button>
            )}
          </div>
        </div>
        {s.status === "DRAFT" && !s.monthOver && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">The month isn&apos;t over: this is a preview. It can be submitted after the month ends.</p>}
        <p className="mt-3 text-xs text-zinc-500">
          Calculated by {s.calculatedBy} {formatDateTime(s.calculatedAt)}
          {s.submittedBy ? ` · submitted by ${s.submittedBy}` : ""}
          {s.approvedBy ? ` · approved by ${s.approvedBy}${s.approvedAt ? ` ${formatDateTime(s.approvedAt)}` : ""}` : ""}
          {s.decisionComment ? ` — “${s.decisionComment}”` : ""}
        </p>
        {s.status === "APPROVED" && (
          <p className="mt-2 text-sm">
            Payment:{" "}
            {s.payment ? (
              <>
                <Link href={`/accounts/payment-requests/${s.payment.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {s.payment.number}
                </Link>{" "}
                <Badge tone={PAYMENT_TONE[s.payment.status] ?? "zinc"}>{s.payment.label}</Badge> {s.payment.paid > 0 && `· paid ${inr(s.payment.paid)} of ${inr(s.payment.amount)}`}
              </>
            ) : s.totals.net < 0 ? (
              "Nothing to pay — the negative amount is carried to the next statement."
            ) : s.totals.net === 0 ? (
              "Nothing to pay."
            ) : (
              <span className="text-amber-700 dark:text-amber-300">No payment request yet.</span>
            )}
          </p>
        )}
      </section>

      {error && !dialog && !adjusting && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {[...groups.values()].map((g) => (
        <section key={`${g.info.planCode}-${g.info.versionNumber}`} className={`${CARD} overflow-x-auto`}>
          <h2 className="font-semibold">
            Plan {String(g.info.planCode)} v{String(g.info.versionNumber)}
          </h2>
          <p className="text-xs text-zinc-500">
            {String(g.info.rule ?? "")} · basis {inr(Number(g.info.basis ?? 0))} from {String(g.info.events ?? 0)} item{Number(g.info.events) === 1 ? "" : "s"} → {inr(Number(g.info.amount ?? 0))}
            {g.info.belowMinimum ? " (below the minimum basis)" : ""}
            {g.info.capped ? ` (capped; ${inr(Number(g.info.gross ?? 0))} before the cap)` : ""}
            {g.info.effectiveRate !== null && g.info.effectiveRate !== undefined ? ` · effective ${String(g.info.effectiveRate)}%` : ""}
          </p>
          <LinesTable lines={g.lines} />
        </section>
      ))}
      {others.length > 0 && (
        <section className={`${CARD} overflow-x-auto`}>
          <h2 className="font-semibold">Other lines</h2>
          <LinesTable lines={others} onRemove={s.can.adjust ? (id) => act(() => send(`${base}/adjustments/${id}`, "DELETE")) : undefined} />
        </section>
      )}
      {s.lines.length === 0 && (
        <div className={CARD}>
          <p className="text-sm text-zinc-500">No lines.</p>
        </div>
      )}

      {dialog && (
        <TextDialog
          spec={dialog}
          busy={busy}
          error={error}
          onClose={() => (setDialog(null), setError(null))}
          onSubmit={async (body) => {
            if (await act(() => send(`${base}/${dialog.action}`, "POST", body))) setDialog(null);
          }}
        />
      )}
      {adjusting && (
        <Modal open onClose={() => setAdjusting(false)} title="Add adjustment">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => send(`${base}/adjustments`, "POST", adj))) setAdjusting(false);
            }}
          >
            <FormField label="Amount (₹, negative to deduct)" htmlFor="adj-amt" required>
              <input id="adj-amt" type="number" step="0.01" required value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Reason" htmlFor="adj-reason" required>
              <textarea id="adj-reason" rows={2} required minLength={3} maxLength={500} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} className={textInputClass()} />
            </FormField>
            <p className="text-xs text-zinc-500">Adjustments aren&apos;t tiered or capped and stay when the month is recalculated.</p>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdjusting(false)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                Add
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LinesTable({ lines, onRemove }: { lines: Line[]; onRemove?: (id: string) => void }) {
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
          <th className="py-2 pr-3">Type</th>
          <th className="py-2 pr-3">Date</th>
          <th className="py-2 pr-3">Detail</th>
          <th className="py-2 pr-3 text-right">Basis</th>
          <th className="py-2 pr-3 text-right">Rate</th>
          <th className="py-2 pr-3 text-right">Amount</th>
          {onRemove && <th />}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
            <td className="py-2 pr-3 whitespace-nowrap">{LINE_KIND_LABELS[l.kind]}</td>
            <td className="py-2 pr-3 whitespace-nowrap">{l.eventDate ?? "—"}</td>
            <td className="py-2 pr-3">
              {l.salesOrderId ? (
                <Link href={`/sales-orders/${l.salesOrderId}`} className="hover:underline">
                  {describe(l)}
                </Link>
              ) : (
                describe(l)
              )}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">{l.basis === null ? "—" : signedInr(l.basis)}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{l.rate === null ? "—" : `${l.rate}%`}</td>
            <td className="py-2 pr-3 text-right font-medium tabular-nums">{signedInr(l.amount)}</td>
            {onRemove && (
              <td className="py-2 text-right">
                {l.kind === "ADJUSTMENT" && (
                  <Button size="xs" variant="secondary" onClick={() => onRemove(l.id)}>
                    Remove
                  </Button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { SUBSCRIPTION_STATE_LABELS, type SubscriptionAccessState } from "@/core/subscriptions/subscription-state";

export interface SubscriptionData {
  subscription: {
    id: string;
    planId: string;
    billingCycle: "MONTHLY" | "ANNUAL";
    isTrial: boolean;
    startedAt: string;
    currentPeriodEndsAt: string | null;
    plan: { id: string; name: string; maxUsers: number | null; currencyCode: string };
    updatedBy: { fullName: string } | null;
  } | null;
  status: {
    state: SubscriptionAccessState;
    readOnly: boolean;
    periodEndsAt: string | null;
    graceEndsAt: string | null;
    daysLeft: number | null;
  };
  activeUsers: number;
  payments: {
    id: string;
    paidAt: string;
    amount: string;
    currencyCode: string;
    method: string;
    reference: string | null;
    billingCycle: string;
    periods: number;
    periodStart: string;
    periodEnd: string;
    plan: { name: string };
    recordedBy: { fullName: string };
  }[];
}

export interface PlanOption {
  id: string;
  name: string;
  monthlyPrice: string | null;
  annualPrice: string | null;
  currencyCode: string;
}

const STATE_STYLES: Record<SubscriptionAccessState, string> = {
  TRIAL: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  UNLIMITED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  GRACE: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  EXPIRED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  NONE: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const METHODS: [string, string][] = [
  ["BANK_TRANSFER", "Bank transfer"],
  ["CHEQUE", "Cheque"],
  ["UPI", "UPI"],
  ["CASH", "Cash"],
  ["CARD", "Card"],
  ["OTHER", "Other"],
];

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function SubscriptionPanel({
  companyId,
  initialData,
  plans,
  canManageBilling,
  onChanged,
}: {
  companyId: string;
  initialData: SubscriptionData;
  plans: PlanOption[];
  canManageBilling: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState(initialData);
  const [dialog, setDialog] = useState<"payment" | "plan" | "period" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sub = data.subscription;
  const [payment, setPayment] = useState({
    planId: sub?.planId ?? plans[0]?.id ?? "",
    billingCycle: sub?.billingCycle ?? "MONTHLY",
    periods: "1",
    amount: "",
    paidAt: today(),
    method: "BANK_TRANSFER",
    reference: "",
    notes: "",
  });
  const [planForm, setPlanForm] = useState({ planId: sub?.planId ?? "", billingCycle: sub?.billingCycle ?? "MONTHLY" });
  const [period, setPeriod] = useState({
    noExpiry: false,
    periodEndsAt: sub?.currentPeriodEndsAt?.slice(0, 10) ?? today(),
    isTrial: sub?.isTrial ?? false,
    reason: "",
  });

  async function reload() {
    const res = await fetch(`/api/v1/platform/companies/${companyId}/subscription`, { cache: "no-store" });
    if (res.ok) setData((await res.json()).data);
    onChanged();
  }

  async function send(path: string, method: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/companies/${companyId}/subscription${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Something went wrong.");
        return;
      }
      setDialog(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function openDialog(kind: "payment" | "plan" | "period") {
    setError(null);
    if (kind === "payment") {
      const plan = plans.find((p) => p.id === (sub?.planId ?? payment.planId)) ?? plans[0];
      const cycle = sub?.billingCycle ?? "MONTHLY";
      const price = cycle === "ANNUAL" ? plan?.annualPrice : plan?.monthlyPrice;
      setPayment((p) => ({ ...p, planId: plan?.id ?? "", billingCycle: cycle, amount: price ?? "", paidAt: today() }));
    }
    if (kind === "plan") setPlanForm({ planId: sub?.planId ?? plans[0]?.id ?? "", billingCycle: sub?.billingCycle ?? "MONTHLY" });
    if (kind === "period") {
      setPeriod({ noExpiry: false, periodEndsAt: sub?.currentPeriodEndsAt?.slice(0, 10) ?? today(), isTrial: sub?.isTrial ?? false, reason: "" });
    }
    setDialog(kind);
  }

  function priceFor(planId: string, cycle: string) {
    const plan = plans.find((p) => p.id === planId);
    return (cycle === "ANNUAL" ? plan?.annualPrice : plan?.monthlyPrice) ?? "";
  }

  const { status } = data;
  const maxUsers = sub?.plan.maxUsers ?? null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Subscription</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[status.state]}`}>
              {SUBSCRIPTION_STATE_LABELS[status.state]}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Payments are recorded here by hand (bank transfer, cheque, UPI…). Recording a payment renews the subscription
            by whole billing periods.
          </p>
        </div>
        {canManageBilling && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openDialog("payment")}
              disabled={plans.length === 0}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Record payment
            </button>
            <button
              type="button"
              onClick={() => openDialog("plan")}
              disabled={plans.length === 0}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Change plan
            </button>
            {sub && (
              <button
                type="button"
                onClick={() => openDialog("period")}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Adjust dates
              </button>
            )}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-zinc-500">Plan</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">
            {sub ? `${sub.plan.name} · ${sub.billingCycle === "ANNUAL" ? "Annual" : "Monthly"}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">{sub?.isTrial ? "Trial ends" : "Paid until"}</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">
            {sub && !sub.currentPeriodEndsAt ? "No expiry" : fmtDate(status.periodEndsAt)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Read-only from</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">
            {status.periodEndsAt ? `${fmtDate(status.periodEndsAt)} (archive from ${fmtDate(status.graceEndsAt)})` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Active users</dt>
          <dd className={`text-zinc-900 dark:text-zinc-100 ${maxUsers !== null && data.activeUsers > maxUsers ? "text-red-600" : ""}`}>
            {data.activeUsers} / {maxUsers ?? "unlimited"}
          </dd>
        </div>
      </dl>

      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="px-4 pt-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">Payments</div>
        <div className="overflow-x-auto p-4 pt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-1 pr-4 font-medium">Paid on</th>
                <th className="py-1 pr-4 font-medium">Amount</th>
                <th className="py-1 pr-4 font-medium">Method / reference</th>
                <th className="py-1 pr-4 font-medium">Plan</th>
                <th className="py-1 pr-4 font-medium">Covers</th>
                <th className="py-1 font-medium">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-zinc-500">
                    No payments recorded yet.
                  </td>
                </tr>
              )}
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-4">{fmtDate(p.paidAt)}</td>
                  <td className="py-1.5 pr-4">
                    {p.currencyCode} {Number(p.amount).toLocaleString("en-IN")}
                  </td>
                  <td className="py-1.5 pr-4">
                    {METHODS.find(([k]) => k === p.method)?.[1] ?? p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </td>
                  <td className="py-1.5 pr-4">
                    {p.plan.name} · {p.periods} × {p.billingCycle === "ANNUAL" ? "year" : "month"}
                  </td>
                  <td className="py-1.5 pr-4">
                    {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
                  </td>
                  <td className="py-1.5">{p.recordedBy.fullName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={dialog === "payment"} onClose={() => setDialog(null)} title="Record payment" maxWidthClass="max-w-lg">
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Plan</span>
              <select
                value={payment.planId}
                onChange={(e) =>
                  setPayment({ ...payment, planId: e.target.value, amount: priceFor(e.target.value, payment.billingCycle) })
                }
                className={inputClass}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Billing cycle</span>
              <select
                value={payment.billingCycle}
                onChange={(e) =>
                  setPayment({
                    ...payment,
                    billingCycle: e.target.value as "MONTHLY" | "ANNUAL",
                    amount: priceFor(payment.planId, e.target.value),
                  })
                }
                className={inputClass}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Periods paid</span>
              <input
                type="number"
                min="1"
                max="36"
                value={payment.periods}
                onChange={(e) => setPayment({ ...payment, periods: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Amount received</span>
              <input
                type="number"
                min="0"
                value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Paid on</span>
              <input
                type="date"
                value={payment.paidAt}
                onChange={(e) => setPayment({ ...payment, paidAt: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Method</span>
              <select
                value={payment.method}
                onChange={(e) => setPayment({ ...payment, method: e.target.value })}
                className={inputClass}
              >
                {METHODS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Reference (UTR, cheque no.…)</span>
            <input
              value={payment.reference}
              onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Notes</span>
            <textarea
              rows={2}
              value={payment.notes}
              onChange={(e) => setPayment({ ...payment, notes: e.target.value })}
              className={inputClass}
            />
          </label>
          <p className="text-xs text-zinc-500">
            The new period starts when the current one ends (or today, if it has already ended). Any trial ends.
          </p>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !payment.planId || payment.amount === ""}
              onClick={() => send("/payments", "POST", { ...payment, periods: Number(payment.periods), amount: Number(payment.amount) })}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
            >
              Record and renew
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={dialog === "plan"} onClose={() => setDialog(null)} title="Change plan">
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Plan</span>
            <select
              value={planForm.planId}
              onChange={(e) => setPlanForm({ ...planForm, planId: e.target.value })}
              className={inputClass}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Billing cycle</span>
            <select
              value={planForm.billingCycle}
              onChange={(e) => setPlanForm({ ...planForm, billingCycle: e.target.value as "MONTHLY" | "ANNUAL" })}
              className={inputClass}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </label>
          <p className="text-xs text-zinc-500">
            The company&apos;s modules switch to the new plan straight away. Dates are not changed.
          </p>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !planForm.planId}
              onClick={() => send("/plan", "PUT", planForm)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
            >
              Change plan
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={dialog === "period"} onClose={() => setDialog(null)} title="Adjust subscription dates">
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={period.noExpiry}
              onChange={(e) => setPeriod({ ...period, noExpiry: e.target.checked })}
            />
            No expiry (complimentary account)
          </label>
          {!period.noExpiry && (
            <>
              <label className="block">
                <span className="text-zinc-600 dark:text-zinc-300">Paid / trial until</span>
                <input
                  type="date"
                  value={period.periodEndsAt}
                  onChange={(e) => setPeriod({ ...period, periodEndsAt: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={period.isTrial}
                  onChange={(e) => setPeriod({ ...period, isTrial: e.target.checked })}
                />
                This is a trial period
              </label>
            </>
          )}
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Reason</span>
            <textarea
              rows={2}
              value={period.reason}
              onChange={(e) => setPeriod({ ...period, reason: e.target.value })}
              placeholder="Kept in the company's audit log"
              className={inputClass}
            />
          </label>
          <p className="text-xs text-zinc-500">
            Use this to extend a trial or correct a date. To renew after a payment, use Record payment instead.
          </p>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || period.reason.trim().length < 5}
              onClick={() =>
                send("/period", "PUT", {
                  noExpiry: period.noExpiry,
                  periodEndsAt: period.noExpiry ? undefined : period.periodEndsAt,
                  isTrial: period.noExpiry ? false : period.isTrial,
                  reason: period.reason,
                })
              }
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

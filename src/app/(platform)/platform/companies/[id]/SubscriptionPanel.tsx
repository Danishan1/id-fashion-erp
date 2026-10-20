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
    listAmount: string | null;
    discountAmount: string;
    freeMonths: number;
    coupon: { code: string } | null;
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
  companyName,
  legalName,
  taxRegistrationNo,
  onChanged,
}: {
  companyId: string;
  initialData: SubscriptionData;
  plans: PlanOption[];
  canManageBilling: boolean;
  companyName?: string;
  legalName?: string | null;
  taxRegistrationNo?: string | null;
  onChanged: () => void;
}) {
  const [data, setData] = useState(initialData);
  const [dialog, setDialog] = useState<"payment" | "plan" | "period" | null>(null);
  const [selectedReceiptPayment, setSelectedReceiptPayment] = useState<SubscriptionData["payments"][number] | null>(null);
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
    couponCode: "",
  });
  // Phase 5: coupon preview (checked, not used, until the payment is saved).
  const [couponPreview, setCouponPreview] = useState<{
    code: string;
    name: string;
    effect: { discountAmount: number; finalAmount: number; freeMonths: number };
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  async function checkCoupon() {
    setCouponError(null);
    setCouponPreview(null);
    if (!payment.couponCode.trim()) return;
    const res = await fetch("/api/v1/platform/coupons/preview", {
      method: "POST",
      headers: { "content-type": "application/json", "x-toast": "off" },
      body: JSON.stringify({
        code: payment.couponCode,
        companyId,
        planId: payment.planId,
        billingCycle: payment.billingCycle,
        amount: Number(payment.amount || 0),
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setCouponError(json?.error?.message ?? "Coupon can't be used.");
      return;
    }
    setCouponPreview({ code: json.data.coupon.code, name: json.data.coupon.name, effect: json.data.effect });
  }
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
      setPayment((p) => ({ ...p, planId: plan?.id ?? "", billingCycle: cycle, amount: price ?? "", paidAt: today(), couponCode: "" }));
      setCouponPreview(null);
      setCouponError(null);
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
                <th className="py-1 pr-4 font-medium">Recorded by</th>
                <th className="py-1 font-medium text-right">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-zinc-500">
                    No payments recorded yet.
                  </td>
                </tr>
              )}
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pr-4">{fmtDate(p.paidAt)}</td>
                  <td className="py-1.5 pr-4">
                    {p.currencyCode} {Number(p.amount).toLocaleString("en-IN")}
                    {p.coupon && (
                      <div className="text-xs text-indigo-600 dark:text-indigo-400">
                        {p.coupon.code}
                        {Number(p.discountAmount) > 0 && ` · −${Number(p.discountAmount).toLocaleString("en-IN")}`}
                        {p.freeMonths > 0 && ` · +${p.freeMonths} free mo`}
                      </div>
                    )}
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
                  <td className="py-1.5 pr-4">{p.recordedBy.fullName}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelectedReceiptPayment(p)}
                      className="rounded border border-zinc-200 px-2 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-zinc-700 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                    >
                      Receipt
                    </button>
                  </td>
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
              <span className="text-zinc-600 dark:text-zinc-300">Price (before coupon)</span>
              <input
                type="number"
                min="0"
                value={payment.amount}
                onChange={(e) => {
                  setPayment({ ...payment, amount: e.target.value });
                  setCouponPreview(null);
                }}
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
          <div>
            <span className="text-zinc-600 dark:text-zinc-300">Coupon (optional)</span>
            <div className="mt-1 flex gap-2">
              <input
                value={payment.couponCode}
                onChange={(e) => {
                  setPayment({ ...payment, couponCode: e.target.value.toUpperCase() });
                  setCouponPreview(null);
                  setCouponError(null);
                }}
                placeholder="e.g. LAUNCH20"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                disabled={!payment.couponCode.trim()}
                onClick={checkCoupon}
                className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-60 dark:border-zinc-700"
              >
                Apply
              </button>
            </div>
            {couponError && <p className="mt-1 text-xs text-red-600">{couponError}</p>}
            {couponPreview && (
              <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                {couponPreview.code} ({couponPreview.name}):{" "}
                {couponPreview.effect.freeMonths > 0
                  ? `+${couponPreview.effect.freeMonths} free month(s) added to the period.`
                  : `−${couponPreview.effect.discountAmount.toLocaleString("en-IN")}, amount received ${couponPreview.effect.finalAmount.toLocaleString("en-IN")}.`}
              </p>
            )}
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
              disabled={busy || !payment.planId || payment.amount === "" || (!!payment.couponCode.trim() && !couponPreview)}
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

      {/* Tax Invoice & Payment Receipt Modal */}
      <Modal
        open={!!selectedReceiptPayment}
        onClose={() => setSelectedReceiptPayment(null)}
        title="SaaS Tax Invoice / Payment Receipt"
        maxWidthClass="max-w-2xl"
      >
        {selectedReceiptPayment && (
          <div className="space-y-4 text-xs">
            {/* Printable Receipt Box */}
            <div id="saas-receipt-print" className="rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
                <div>
                  <div className="text-base font-bold text-indigo-600 dark:text-indigo-400">Fashion ERP SaaS</div>
                  <div className="text-xs text-zinc-500">Cloud Enterprise Software Solutions</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">GSTIN: 27AABCI1234F1Z5 · SAC: 998313</div>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    PAID IN FULL
                  </span>
                  <div className="mt-1 font-mono text-xs font-semibold">
                    INV-SAAS-{selectedReceiptPayment.id.slice(0, 8).toUpperCase()}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Date: {fmtDate(selectedReceiptPayment.paidAt)}
                  </div>
                </div>
              </div>

              {/* Billed To / From */}
              <div className="grid grid-cols-2 gap-4 py-3 border-b border-zinc-100 dark:border-zinc-800 text-xs">
                <div>
                  <div className="font-semibold text-zinc-500 uppercase tracking-wider text-xs">Billed To:</div>
                  <div className="mt-0.5 font-bold text-zinc-900 dark:text-zinc-100">{companyName ?? "Customer Company"}</div>
                  {legalName && <div className="text-zinc-600 dark:text-zinc-400">{legalName}</div>}
                  <div className="text-zinc-500">GST / Tax ID: {taxRegistrationNo ?? "Not provided / Unregistered"}</div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-500 uppercase tracking-wider text-xs">Service Period:</div>
                  <div className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {fmtDate(selectedReceiptPayment.periodStart)} – {fmtDate(selectedReceiptPayment.periodEnd)}
                  </div>
                  <div className="mt-1 text-zinc-500">
                    Plan: <span className="font-medium text-zinc-800 dark:text-zinc-200">{selectedReceiptPayment.plan.name}</span> ({selectedReceiptPayment.periods} × {selectedReceiptPayment.billingCycle.toLowerCase()})
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="py-3">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700">
                      <th className="py-1.5 font-semibold">Item & Description</th>
                      <th className="py-1.5 text-right font-semibold">SAC</th>
                      <th className="py-1.5 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <tr>
                      <td className="py-2">
                        <div className="font-medium">{selectedReceiptPayment.plan.name} Subscription</div>
                        <div className="text-xs text-zinc-500">
                          Access to multi-tenant ERP features ({selectedReceiptPayment.billingCycle.toLowerCase()} cycle)
                        </div>
                        {selectedReceiptPayment.coupon && (
                          <div className="text-xs text-emerald-600">
                            Coupon Applied: {selectedReceiptPayment.coupon.code}
                            {Number(selectedReceiptPayment.discountAmount) > 0 && ` (−₹${Number(selectedReceiptPayment.discountAmount).toLocaleString("en-IN")})`}
                          </div>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono text-zinc-500">998313</td>
                      <td className="py-2 text-right font-medium">
                        ₹{(Number(selectedReceiptPayment.amount) / 1.18).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot className="border-t border-zinc-200 text-xs dark:border-zinc-700">
                    <tr>
                      <td colSpan={2} className="py-1 text-right text-zinc-500">Taxable Subtotal:</td>
                      <td className="py-1 text-right font-medium">
                        ₹{(Number(selectedReceiptPayment.amount) / 1.18).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={2} className="py-0.5 text-right text-zinc-500">CGST (9%):</td>
                      <td className="py-0.5 text-right">
                        ₹{((Number(selectedReceiptPayment.amount) / 1.18) * 0.09).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={2} className="py-0.5 text-right text-zinc-500">SGST (9%):</td>
                      <td className="py-0.5 text-right">
                        ₹{((Number(selectedReceiptPayment.amount) / 1.18) * 0.09).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="border-t border-zinc-200 font-bold text-xs dark:border-zinc-700">
                      <td colSpan={2} className="py-1.5 text-right text-zinc-900 dark:text-zinc-50">Total Paid:</td>
                      <td className="py-1.5 text-right text-indigo-600 dark:text-indigo-400">
                        ₹{Number(selectedReceiptPayment.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Payment Details Footer */}
              <div className="mt-2 rounded bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    Payment Method: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{selectedReceiptPayment.method}</span>
                    {selectedReceiptPayment.reference && <span> (Ref: {selectedReceiptPayment.reference})</span>}
                  </div>
                  <div className="text-right">
                    Recorded By: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{selectedReceiptPayment.recordedBy.fullName}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedReceiptPayment(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                <span>🖨️ Print / Save PDF</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

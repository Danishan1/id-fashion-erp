"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/date-format";

export interface PlatformOverviewData {
  overall: {
    companies: number;
    activeCompanies: number;
    customers: number;
    suppliers: number;
    employees: number;
    users: number;
  };
  companies: {
    id: string;
    name: string;
    isActive: boolean;
    customers: number;
    suppliers: number;
    employees: number;
    users: number;
  }[];
  financials: {
    mrr: number;
    arr: number;
    totalRevenue: number;
    activePaidSubscriptions: number;
    trialSubscriptions: number;
    graceSubscriptions: number;
    expiredSubscriptions: number;
  };
  planBreakdown: {
    id: string;
    name: string;
    code: string;
    monthlyPrice: number;
    annualPrice: number;
    companyCount: number;
  }[];
  recentPayments: {
    id: string;
    companyId: string;
    companyName: string;
    planName: string;
    amount: number;
    currencyCode: string;
    paidAt: string;
    method: string;
  }[];
  expiringSoon: {
    companyId: string;
    companyName: string;
    planName: string | null;
    isTrial: boolean;
    periodEndsAt: string;
    daysLeft: number;
    statusState: string;
  }[];
  recentActivity: {
    id: string;
    performedAt: string;
    tableName: string;
    action: string;
    companyName: string;
    operatorName: string | null;
  }[];
}

function fmtCurrency(val: number, currency: string = "INR"): string {
  return `${currency === "INR" ? "₹" : currency} ${val.toLocaleString("en-IN")}`;
}

export function PlatformOverviewClient({ data }: { data: PlatformOverviewData }) {
  const { overall, financials, planBreakdown, recentPayments, expiringSoon, recentActivity } = data;
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);

  async function runLifecycleJob() {
    setLifecycleBusy(true);
    setLifecycleMessage(null);
    try {
      const res = await fetch("/api/v1/platform/subscription-lifecycle/run", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setLifecycleMessage(`Sent ${json.data.sent} renewal notice(s) to factory admins.`);
        setTimeout(() => setLifecycleMessage(null), 4000);
      } else {
        setLifecycleMessage("Failed to trigger notices.");
      }
    } catch {
      setLifecycleMessage("Error contacting server.");
    } finally {
      setLifecycleBusy(false);
    }
  }

  const totalPlanSubscribers = planBreakdown.reduce((acc, p) => acc + p.companyCount, 0);

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">SaaS Platform Command Center</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Real-time financial analytics, multi-tenant subscription health, and cross-company activity monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/platform/companies/new"
            className="rounded-md bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            + Provision Company
          </Link>
          <Link
            href="/platform/companies"
            className="rounded-md border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            All Companies
          </Link>
        </div>
      </div>

      {/* Revenue & Financial KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-gradient-to-br from-indigo-50/60 to-white p-4 shadow-sm dark:border-zinc-800 dark:from-indigo-950/20 dark:to-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
              Monthly Recurring (MRR)
            </span>
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300">
              Run Rate
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {fmtCurrency(financials.mrr)}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            ARR: <span className="font-medium text-zinc-800 dark:text-zinc-200">{fmtCurrency(financials.arr)}</span> / yr
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Total Revenue Collected
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {fmtCurrency(financials.totalRevenue)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            From offline & recorded payments
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            Subscriptions Health
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{financials.activePaidSubscriptions}</span>
            <span className="text-xs font-medium text-emerald-600">Active Paid</span>
            <span className="text-zinc-300 dark:text-zinc-700">|</span>
            <span className="text-sm font-semibold text-amber-600">{financials.trialSubscriptions}</span>
            <span className="text-xs text-zinc-500">Trial</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {financials.graceSubscriptions} in grace · {financials.expiredSubscriptions} expired
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            Hosted Ecosystem
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{overall.activeCompanies}</span>
            <span className="text-xs text-zinc-500">/ {overall.companies} Factories</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {overall.users} active ERP user accounts
          </div>
        </div>
      </div>

      {/* Expiring Soon Banner / Alert (If any) */}
      {expiringSoon.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Action Required: {expiringSoon.length} {expiringSoon.length === 1 ? "Company" : "Companies"} Expiring Within 7 Days
              </h3>
            </div>
            <div className="flex items-center gap-3">
              {lifecycleMessage && (
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {lifecycleMessage}
                </span>
              )}
              <button
                type="button"
                disabled={lifecycleBusy}
                onClick={runLifecycleJob}
                className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-zinc-800 dark:text-amber-200"
              >
                {lifecycleBusy ? "Sending..." : "🔔 Send Renewal Notices Now"}
              </button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-amber-200/80 text-amber-800/80 dark:border-amber-900/40 dark:text-amber-300/80">
                  <th className="py-1.5 pr-4 font-semibold">Tenant</th>
                  <th className="py-1.5 px-4 font-semibold">Plan</th>
                  <th className="py-1.5 px-4 font-semibold">Stage</th>
                  <th className="py-1.5 px-4 font-semibold">Expiry Date</th>
                  <th className="py-1.5 px-4 font-semibold">Days Remaining</th>
                  <th className="py-1.5 pl-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200/50 dark:divide-amber-900/30">
                {expiringSoon.map((exp) => (
                  <tr key={exp.companyId}>
                    <td className="py-2 pr-4 font-medium text-amber-950 dark:text-amber-100">{exp.companyName}</td>
                    <td className="py-2 px-4 text-amber-900 dark:text-amber-200">{exp.planName ?? "Standard"}</td>
                    <td className="py-2 px-4">
                      <span className="inline-flex rounded bg-amber-200/80 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                        {exp.isTrial ? "Trial" : "Subscription"}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-amber-900 dark:text-amber-200">{formatDate(exp.periodEndsAt)}</td>
                    <td className="py-2 px-4 font-bold text-red-600 dark:text-red-400">
                      {exp.daysLeft <= 0 ? "Expires Today" : `${exp.daysLeft} day${exp.daysLeft > 1 ? "s" : ""} left`}
                    </td>
                    <td className="py-2 pl-4 text-right whitespace-nowrap">
                      <Link
                        href={`/platform/companies/${exp.companyId}`}
                        className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100 dark:bg-zinc-800 dark:text-amber-200 dark:hover:bg-zinc-700"
                      >
                        Manage & Renew
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Two-Column Analytics Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Plan Breakdown */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Subscription Plans Distribution</h2>
              <p className="text-xs text-zinc-500">Distribution of active tenant subscriptions across tiers</p>
            </div>
            <Link href="/platform/plans" className="text-xs font-medium text-indigo-600 hover:underline">
              Manage Plans →
            </Link>
          </div>
          <div className="mt-4 space-y-4">
            {planBreakdown.length === 0 ? (
              <p className="text-center text-xs text-zinc-400 py-4">No active plans configured.</p>
            ) : (
              planBreakdown.map((plan) => {
                const percentage = totalPlanSubscribers > 0 ? Math.round((plan.companyCount / totalPlanSubscribers) * 100) : 0;
                return (
                  <div key={plan.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">{plan.name}</span>
                      <div className="text-right">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{plan.companyCount} Factories</span>
                        <span className="text-zinc-400 ml-1.5">({percentage}%)</span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-zinc-400">
                      <span>{plan.monthlyPrice > 0 ? `₹${plan.monthlyPrice.toLocaleString("en-IN")}/mo` : "Custom pricing"}</span>
                      <span>{plan.annualPrice > 0 ? `₹${plan.annualPrice.toLocaleString("en-IN")}/yr` : ""}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Cashflow & Payments */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent Payments & Cashflow</h2>
              <p className="text-xs text-zinc-500">Latest recorded payments from tenant renewals</p>
            </div>
            <span className="text-xs text-zinc-400">Last 5 Transactions</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 px-3 font-medium">Company</th>
                  <th className="py-2 px-3 font-medium">Plan</th>
                  <th className="py-2 px-3 font-medium">Method</th>
                  <th className="py-2 pl-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recentPayments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-zinc-400">
                      No payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                      <td className="py-2.5 pr-3 text-zinc-500 whitespace-nowrap">{formatDate(p.paidAt)}</td>
                      <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                        <Link href={`/platform/companies/${p.companyId}`} className="hover:text-indigo-600 hover:underline">
                          {p.companyName}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-300">{p.planName}</td>
                      <td className="py-2.5 px-3 text-zinc-500">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {p.method}
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-right font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {fmtCurrency(p.amount, p.currencyCode)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Platform Activity Feed */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent Platform Operations</h2>
            <p className="text-xs text-zinc-500">Live operational events recorded by platform operators</p>
          </div>
          <Link href="/platform/audit-logs" className="text-xs font-medium text-indigo-600 hover:underline">
            Full Audit Trail →
          </Link>
        </div>
        <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {recentActivity.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-400">No operational activity recorded yet.</p>
          ) : (
            recentActivity.map((act) => (
              <div key={act.id} className="flex items-center justify-between py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      act.action === "CREATE"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : act.action === "DELETE"
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                    }`}
                  >
                    {act.action}
                  </span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{act.companyName}</span>
                  <span className="text-zinc-400">·</span>
                  <span className="font-mono text-xs text-zinc-500">{act.tableName}</span>
                </div>
                <div className="flex items-center gap-3 text-zinc-400">
                  <span>{act.operatorName ? `by ${act.operatorName}` : "System"}</span>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="whitespace-nowrap">{formatDate(act.performedAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

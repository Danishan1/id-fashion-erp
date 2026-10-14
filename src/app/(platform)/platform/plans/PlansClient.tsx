"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ENTITLEMENT_PACKAGES } from "@/config/module-entitlements";

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: string | null;
  annualPrice: string | null;
  currencyCode: string;
  trialDays: number;
  maxUsers: number | null;
  isActive: boolean;
  isDefaultTrialPlan: boolean;
  sortOrder: number;
  modules: { packageKey: string }[];
  _count: { subscriptions: number };
}

interface FormState {
  code: string;
  name: string;
  description: string;
  monthlyPrice: string;
  annualPrice: string;
  currencyCode: string;
  trialDays: string;
  maxUsers: string;
  isActive: boolean;
  isDefaultTrialPlan: boolean;
  sortOrder: string;
  modules: string[];
}

const EMPTY: FormState = {
  code: "",
  name: "",
  description: "",
  monthlyPrice: "",
  annualPrice: "",
  currencyCode: "INR",
  trialDays: "14",
  maxUsers: "",
  isActive: true,
  isDefaultTrialPlan: false,
  sortOrder: "0",
  modules: ENTITLEMENT_PACKAGES.map((p) => p.key),
};

function toForm(plan: Plan): FormState {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "",
    monthlyPrice: plan.monthlyPrice ?? "",
    annualPrice: plan.annualPrice ?? "",
    currencyCode: plan.currencyCode,
    trialDays: String(plan.trialDays),
    maxUsers: plan.maxUsers === null ? "" : String(plan.maxUsers),
    isActive: plan.isActive,
    isDefaultTrialPlan: plan.isDefaultTrialPlan,
    sortOrder: String(plan.sortOrder),
    modules: plan.modules.map((m) => m.packageKey),
  };
}

function money(value: string | null, currency: string) {
  if (value === null) return "—";
  return `${currency} ${Number(value).toLocaleString("en-IN")}`;
}

const inputClass = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function PlansClient({ initialPlans, canManage }: { initialPlans: Plan[]; canManage: boolean }) {
  const [plans, setPlans] = useState(initialPlans);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(target: Plan | "new") {
    setEditing(target);
    setForm(target === "new" ? EMPTY : toForm(target));
    setError(null);
  }

  async function reload() {
    const res = await fetch("/api/v1/platform/plans", { cache: "no-store" });
    if (res.ok) setPlans((await res.json()).data);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing === "new" ? "/api/v1/platform/plans" : `/api/v1/platform/plans/${editing.id}`, {
        method: editing === "new" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Couldn't save the plan.");
        return;
      }
      setEditing(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function toggleModule(key: string) {
    setForm((f) => ({ ...f, modules: f.modules.includes(key) ? f.modules.filter((k) => k !== key) : [...f.modules, key] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Plans</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Each plan sets prices, the free-trial length, a user limit and which modules are included. A company&apos;s
            plan decides its modules; you can still turn single modules on or off per company.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => open("new")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            New Plan
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Monthly</th>
              <th className="px-4 py-2 font-medium">Annual</th>
              <th className="px-4 py-2 font-medium">Trial</th>
              <th className="px-4 py-2 font-medium">Users</th>
              <th className="px-4 py-2 font-medium">Modules</th>
              <th className="px-4 py-2 font-medium">Companies</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-zinc-500">
                  No plans yet.
                </td>
              </tr>
            )}
            {plans.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">
                    {p.name}
                    {p.isDefaultTrialPlan && (
                      <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                        Default trial
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">{p.code}</div>
                </td>
                <td className="px-4 py-2">{money(p.monthlyPrice, p.currencyCode)}</td>
                <td className="px-4 py-2">{money(p.annualPrice, p.currencyCode)}</td>
                <td className="px-4 py-2">{p.trialDays} days</td>
                <td className="px-4 py-2">{p.maxUsers ?? "Unlimited"}</td>
                <td className="px-4 py-2">
                  {p.modules.length} / {ENTITLEMENT_PACKAGES.length}
                </td>
                <td className="px-4 py-2">{p._count.subscriptions}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.isActive
                        ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {p.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {canManage && (
                    <button type="button" onClick={() => open(p)} className="text-indigo-600 hover:underline">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New plan" : "Edit plan"}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Code</span>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputClass} />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </label>
          </div>
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Description</span>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Monthly price</span>
              <input
                type="number"
                min="0"
                value={form.monthlyPrice}
                onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Annual price</span>
              <input
                type="number"
                min="0"
                value={form.annualPrice}
                onChange={(e) => setForm({ ...form, annualPrice: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Currency</span>
              <input
                value={form.currencyCode}
                maxLength={3}
                onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Trial days</span>
              <input
                type="number"
                min="0"
                value={form.trialDays}
                onChange={(e) => setForm({ ...form, trialDays: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Max active users</span>
              <input
                type="number"
                min="1"
                placeholder="Unlimited"
                value={form.maxUsers}
                onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Sort order</span>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Included modules</div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {ENTITLEMENT_PACKAGES.map((p) => (
                <label key={p.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={form.modules.includes(p.key)} onChange={() => toggleModule(p.key)} />
                  {p.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Dashboard, Masters, Sales Orders and Administration are always included.</p>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active (can be assigned)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isDefaultTrialPlan}
                onChange={(e) => setForm({ ...form, isDefaultTrialPlan: e.target.checked })}
              />
              Default trial plan for new companies
            </label>
          </div>
          {editing !== "new" && editing && editing._count.subscriptions > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {editing._count.subscriptions} {editing._count.subscriptions === 1 ? "company is" : "companies are"} on this
              plan. Module changes apply to them straight away.
            </p>
          )}
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !form.code.trim() || !form.name.trim()}
              onClick={save}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

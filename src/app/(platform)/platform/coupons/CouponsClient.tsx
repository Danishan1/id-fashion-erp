"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { COUPON_DISCOUNT_TYPE_LABELS, COUPON_DISCOUNT_TYPES, type CouponDiscountTypeValue } from "@/modules/platform/coupon.schema";

interface Coupon {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discountType: CouponDiscountTypeValue;
  discountValue: string;
  currencyCode: string;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCompany: number;
  billingCycles: ("MONTHLY" | "ANNUAL")[];
  isActive: boolean;
  plans: { plan: { id: string; name: string } }[];
  _count: { redemptions: number };
}

interface FormState {
  code: string;
  name: string;
  description: string;
  discountType: CouponDiscountTypeValue;
  discountValue: string;
  currencyCode: string;
  validFrom: string;
  validUntil: string;
  maxRedemptions: string;
  maxRedemptionsPerCompany: string;
  billingCycles: ("MONTHLY" | "ANNUAL")[];
  planIds: string[];
  isActive: boolean;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  description: "",
  discountType: "PERCENT",
  discountValue: "",
  currencyCode: "INR",
  validFrom: "",
  validUntil: "",
  maxRedemptions: "",
  maxRedemptionsPerCompany: "1",
  billingCycles: [],
  planIds: [],
  isActive: true,
};

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function toForm(c: Coupon): FormState {
  return {
    code: c.code,
    name: c.name,
    description: c.description ?? "",
    discountType: c.discountType,
    discountValue: String(Number(c.discountValue)),
    currencyCode: c.currencyCode,
    validFrom: dateOnly(c.validFrom),
    validUntil: dateOnly(c.validUntil),
    maxRedemptions: c.maxRedemptions === null ? "" : String(c.maxRedemptions),
    maxRedemptionsPerCompany: String(c.maxRedemptionsPerCompany),
    billingCycles: c.billingCycles,
    planIds: c.plans.map((p) => p.plan.id),
    isActive: c.isActive,
  };
}

export function describeDiscount(c: { discountType: CouponDiscountTypeValue; discountValue: string | number; currencyCode: string }) {
  const v = Number(c.discountValue);
  switch (c.discountType) {
    case "PERCENT":
      return `${v}% off`;
    case "FIXED_AMOUNT":
      return `${c.currencyCode} ${v.toLocaleString("en-IN")} off`;
    case "FREE_MONTHS":
      return `${v} free ${v === 1 ? "month" : "months"}`;
    case "TRIAL_EXTENSION":
      return `+${v} trial days`;
  }
}

const VALUE_LABEL: Record<CouponDiscountTypeValue, string> = {
  PERCENT: "Percent off (1–100)",
  FIXED_AMOUNT: "Amount off",
  FREE_MONTHS: "Free months",
  TRIAL_EXTENSION: "Extra trial days",
};

const inputClass = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function validity(c: Coupon) {
  if (!c.validFrom && !c.validUntil) return "Always";
  return `${c.validFrom ? new Date(c.validFrom).toLocaleDateString("en-IN") : "…"} – ${
    c.validUntil ? new Date(c.validUntil).toLocaleDateString("en-IN") : "…"
  }`;
}

export function CouponsClient({
  initialCoupons,
  plans,
  canManage,
}: {
  initialCoupons: Coupon[];
  plans: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const used = editing && editing !== "new" ? editing._count.redemptions > 0 : false;

  function open(target: Coupon | "new") {
    setEditing(target);
    setForm(target === "new" ? EMPTY : toForm(target));
    setError(null);
  }

  async function reload() {
    const res = await fetch("/api/v1/platform/coupons", { cache: "no-store" });
    if (res.ok) setCoupons((await res.json()).data);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing === "new" ? "/api/v1/platform/coupons" : `/api/v1/platform/coupons/${editing.id}`, {
        method: editing === "new" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Couldn't save the coupon.");
        return;
      }
      setEditing(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Coupons</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Offers you apply when recording a company&apos;s payment (a discount or free months) or when creating a
            company (a longer free trial).
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => open("new")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            New Coupon
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Coupon</th>
              <th className="px-4 py-2 font-medium">Offer</th>
              <th className="px-4 py-2 font-medium">Valid</th>
              <th className="px-4 py-2 font-medium">Plans</th>
              <th className="px-4 py-2 font-medium">Used</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                  No coupons yet.
                </td>
              </tr>
            )}
            {coupons.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <div className="font-mono font-medium text-zinc-900 dark:text-zinc-50">{c.code}</div>
                  <div className="text-xs text-zinc-500">{c.name}</div>
                </td>
                <td className="px-4 py-2">
                  {describeDiscount(c)}
                  {c.billingCycles.length > 0 && (
                    <div className="text-xs text-zinc-500">{c.billingCycles.map((b) => b.toLowerCase()).join(" / ")} only</div>
                  )}
                </td>
                <td className="px-4 py-2">{validity(c)}</td>
                <td className="px-4 py-2">{c.plans.length === 0 ? "Any" : c.plans.map((p) => p.plan.name).join(", ")}</td>
                <td className="px-4 py-2">
                  {c._count.redemptions}
                  {c.maxRedemptions !== null && ` / ${c.maxRedemptions}`}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.isActive
                        ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {c.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {canManage && (
                    <button type="button" onClick={() => open(c)} className="text-indigo-600 hover:underline">
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
        title={editing === "new" ? "New coupon" : "Edit coupon"}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Code</span>
              <input
                value={form.code}
                disabled={used}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className={`${inputClass} font-mono`}
              />
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
              <span className="text-zinc-600 dark:text-zinc-300">Offer type</span>
              <select
                value={form.discountType}
                disabled={used}
                onChange={(e) => setForm({ ...form, discountType: e.target.value as CouponDiscountTypeValue })}
                className={inputClass}
              >
                {COUPON_DISCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COUPON_DISCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">{VALUE_LABEL[form.discountType]}</span>
              <input
                type="number"
                min="0"
                value={form.discountValue}
                disabled={used}
                onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                className={inputClass}
              />
            </label>
            {form.discountType === "FIXED_AMOUNT" && (
              <label className="block">
                <span className="text-zinc-600 dark:text-zinc-300">Currency</span>
                <input
                  value={form.currencyCode}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}
                  className={inputClass}
                />
              </label>
            )}
          </div>
          {used && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This coupon has been used, so its code and discount are locked. You can still change dates, limits, plans
              and whether it&apos;s active.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Valid from</span>
              <input
                type="date"
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Valid until</span>
              <input
                type="date"
                value={form.validUntil}
                onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Total uses allowed</span>
              <input
                type="number"
                min="1"
                placeholder="Unlimited"
                value={form.maxRedemptions}
                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Uses per company</span>
              <input
                type="number"
                min="1"
                value={form.maxRedemptionsPerCompany}
                onChange={(e) => setForm({ ...form, maxRedemptionsPerCompany: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Plans (none ticked = any plan)</div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {plans.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.planIds.includes(p.id)}
                    onChange={() => setForm({ ...form, planIds: toggle(form.planIds, p.id) })}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          {form.discountType !== "TRIAL_EXTENSION" && (
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Billing cycles (none ticked = any)</div>
              <div className="mt-1 flex gap-6">
                {(["MONTHLY", "ANNUAL"] as const).map((b) => (
                  <label key={b} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.billingCycles.includes(b)}
                      onChange={() => setForm({ ...form, billingCycles: toggle(form.billingCycles, b) })}
                    />
                    {b === "MONTHLY" ? "Monthly" : "Annual"}
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active (can be used)
          </label>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !form.code.trim() || !form.name.trim() || !form.discountValue}
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

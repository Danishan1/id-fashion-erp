"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-format";

interface Settings {
  quotationApprovalMaxDiscountPercent: number;
  quotationApprovalMaxTotal: number;
  quotationDefaultValidityDays: number;
  quotationDefaultTerms: string | null;
  updatedAt: string | null;
}

export function SalesMarketingSettingsForm({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const [v, setV] = useState({
    quotationApprovalMaxDiscountPercent: String(initial.quotationApprovalMaxDiscountPercent),
    quotationApprovalMaxTotal: String(initial.quotationApprovalMaxTotal),
    quotationDefaultValidityDays: String(initial.quotationDefaultValidityDays),
    quotationDefaultTerms: initial.quotationDefaultTerms ?? "",
  });
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/v1/sales-marketing/settings", { method: "PUT", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify(v) });
    setSaving(false);
    if (!res.ok) return setMessage({ ok: false, text: await getApiErrorMessage(res) });
    setUpdatedAt((await res.json()).data.updatedAt);
    setMessage({ ok: true, text: "Saved. New limits apply to quotations submitted or issued from now on." });
  };

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Quotation approval</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        A quotation needs approval before it is issued when any line discount is above the first limit or its grand total is above the second. The approver can&apos;t be
        the person who prepared or submitted it.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Max line discount without approval (%)" htmlFor="maxDiscount" required>
          <input id="maxDiscount" type="number" min={0} max={100} step="0.01" required disabled={!canEdit} value={v.quotationApprovalMaxDiscountPercent} onChange={(e) => setV({ ...v, quotationApprovalMaxDiscountPercent: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Max grand total without approval (₹)" htmlFor="maxTotal" required>
          <input id="maxTotal" type="number" min={0} step="0.01" required disabled={!canEdit} value={v.quotationApprovalMaxTotal} onChange={(e) => setV({ ...v, quotationApprovalMaxTotal: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <h2 className="pt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">New quotations</h2>
      <FormField label="Default validity (days)" htmlFor="validity" required>
        <input id="validity" type="number" min={1} max={365} required disabled={!canEdit} value={v.quotationDefaultValidityDays} onChange={(e) => setV({ ...v, quotationDefaultValidityDays: e.target.value })} className={`${textInputClass()} max-w-[10rem]`} />
      </FormField>
      <FormField label="Default terms & conditions" htmlFor="terms">
        <textarea id="terms" rows={5} maxLength={10000} disabled={!canEdit} value={v.quotationDefaultTerms} onChange={(e) => setV({ ...v, quotationDefaultTerms: e.target.value })} className={textInputClass()} />
      </FormField>
      {message && <p className={`text-sm ${message.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{message.text}</p>}
      <div className="flex items-center gap-3">
        {canEdit && (
          <Button type="submit" isLoading={saving} loadingLabel="Saving…">
            Save settings
          </Button>
        )}
        <span className="text-xs text-zinc-500">{updatedAt ? `Last changed ${formatDateTime(updatedAt)}` : "Using the defaults (10% / ₹5,00,000 / 30 days)."}</span>
      </div>
    </form>
  );
}

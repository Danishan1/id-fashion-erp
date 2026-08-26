"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface CompanyData {
  name: string;
  legalName: string | null;
  taxRegistrationNo: string | null;
  baseCurrencyCode: string;
  fiscalYearStartMonth: number;
  addressJson: { line1?: string } | null;
}

export function AdminCompanySettingsPanel({ canManage }: { canManage: boolean }) {
  const [form, setForm] = useState({ name: "", legalName: "", taxRegistrationNo: "", fiscalYearStartMonth: 1, addressLine: "" });
  const [baseCurrencyCode, setBaseCurrencyCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/administration/company")
      .then((res) => res.json())
      .then((body: { data: CompanyData }) => {
        const c = body.data;
        setForm({
          name: c.name,
          legalName: c.legalName ?? "",
          taxRegistrationNo: c.taxRegistrationNo ?? "",
          fiscalYearStartMonth: c.fiscalYearStartMonth,
          addressLine: c.addressJson?.line1 ?? "",
        });
        setBaseCurrencyCode(c.baseCurrencyCode);
      })
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/v1/administration/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save company settings");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save company settings");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <p className="text-sm text-zinc-400">Loading…</p>;

  return (
    <div className="max-w-lg space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <FormField label="Company Name" htmlFor="companyName" required>
        <input
          id="companyName"
          disabled={!canManage}
          className={textInputClass()}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </FormField>
      <FormField label="Legal Name" htmlFor="legalName">
        <input
          id="legalName"
          disabled={!canManage}
          className={textInputClass()}
          value={form.legalName}
          onChange={(e) => setForm({ ...form, legalName: e.target.value })}
        />
      </FormField>
      <FormField label="Tax Registration No." htmlFor="taxRegNo">
        <input
          id="taxRegNo"
          disabled={!canManage}
          className={textInputClass()}
          value={form.taxRegistrationNo}
          onChange={(e) => setForm({ ...form, taxRegistrationNo: e.target.value })}
        />
      </FormField>
      <FormField label="Base Currency" htmlFor="baseCurrency">
        <input id="baseCurrency" disabled className={textInputClass()} value={baseCurrencyCode} />
        <p className="mt-1 text-xs text-zinc-400">
          Not editable here — every posted financial document freezes its currency against this value; changing it after real
          transactions exist would misrepresent historical reports.
        </p>
      </FormField>
      <FormField label="Fiscal Year Start Month" htmlFor="fyStart" required>
        <select
          id="fyStart"
          disabled={!canManage}
          className={textInputClass()}
          value={form.fiscalYearStartMonth}
          onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2000, m - 1, 1).toLocaleString(undefined, { month: "long" })}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Address" htmlFor="companyAddress">
        <input
          id="companyAddress"
          disabled={!canManage}
          className={textInputClass()}
          value={form.addressLine}
          onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
        />
      </FormField>

      {canManage && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={isSaving || !form.name}
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

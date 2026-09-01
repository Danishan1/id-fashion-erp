"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { textInputClass } from "@/components/ui/FormField";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface TaxType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface TaxRate {
  id: string;
  taxTypeId: string;
  name: string;
  ratePercentage: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  taxType: { id: string; name: string };
}

function TaxTypesSection({ rows, onReload }: { rows: TaxType[]; onReload: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState({ code: "", name: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<TaxType | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/tax-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save.");
      return;
    }
    setValues({ code: "", name: "" });
    setShowForm(false);
    onReload();
  };

  const confirmToggle = async () => {
    if (!pending) return;
    await fetch(`/api/v1/tax-types/${pending.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !pending.isActive }),
    });
    setPending(null);
    onReload();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Tax Types</h2>
        <button onClick={() => setShowForm((s) => !s)} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          + Add
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex-1 min-w-[100px]">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Code</label>
            <input required value={values.code} onChange={(e) => setValues({ ...values, code: e.target.value })} className={textInputClass()} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</label>
            <input required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className={textInputClass()} />
          </div>
          <button type="submit" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Add
          </button>
          <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
            Cancel
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">{row.code}</td>
                <td className="px-4 py-2">{row.name}</td>
                <td className="px-4 py-2">
                  <ToggleSwitch
                    checked={row.isActive}
                    onToggle={() => setPending(row)}
                    label={row.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={pending !== null}
        title={pending?.isActive ? "Deactivate tax type?" : "Activate tax type?"}
        message={`"${pending?.name}" will be ${pending?.isActive ? "deactivated" : "activated"}.`}
        confirmLabel={pending?.isActive ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pending?.isActive)}
        onConfirm={confirmToggle}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

function TaxRatesSection({ taxTypes }: { taxTypes: TaxType[] }) {
  const [rows, setRows] = useState<TaxRate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [values, setValues] = useState({ taxTypeId: "", name: "", ratePercentage: "", effectiveFrom: "", effectiveTo: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<TaxRate | null>(null);

  const load = () =>
    fetch("/api/v1/tax-rates")
      .then((res) => res.json())
      .then((body) => setRows(body.data ?? []));

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/v1/tax-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save.");
      return;
    }
    setValues({ taxTypeId: "", name: "", ratePercentage: "", effectiveFrom: "", effectiveTo: "" });
    setShowForm(false);
    load();
  };

  const confirmToggle = async () => {
    if (!pending) return;
    await fetch(`/api/v1/tax-rates/${pending.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !pending.isActive }),
    });
    setPending(null);
    load();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Tax Rates</h2>
        <button onClick={() => setShowForm((s) => !s)} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          + Add
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="min-w-[160px] flex-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Tax Type</label>
            <select
              required
              value={values.taxTypeId}
              onChange={(e) => setValues({ ...values, taxTypeId: e.target.value })}
              className={textInputClass()}
            >
              <option value="">— Select —</option>
              {taxTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</label>
            <input required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} className={textInputClass()} />
          </div>
          <div className="min-w-[100px]">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Rate %</label>
            <input
              required
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={values.ratePercentage}
              onChange={(e) => setValues({ ...values, ratePercentage: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Effective From</label>
            <input
              required
              type="date"
              value={values.effectiveFrom}
              onChange={(e) => setValues({ ...values, effectiveFrom: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Effective To</label>
            <input
              type="date"
              value={values.effectiveTo}
              onChange={(e) => setValues({ ...values, effectiveTo: e.target.value })}
              className={textInputClass()}
            />
          </div>
          <button type="submit" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Add
          </button>
          <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
            Cancel
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-2 font-medium">Tax Type</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Rate %</th>
              <th className="px-4 py-2 font-medium">Effective From</th>
              <th className="px-4 py-2 font-medium">Effective To</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">{row.taxType?.name}</td>
                <td className="px-4 py-2">{row.name}</td>
                <td className="px-4 py-2">{row.ratePercentage}%</td>
                <td className="px-4 py-2">{row.effectiveFrom?.slice(0, 10)}</td>
                <td className="px-4 py-2">{row.effectiveTo ? row.effectiveTo.slice(0, 10) : "Onward"}</td>
                <td className="px-4 py-2">
                  <ToggleSwitch
                    checked={row.isActive}
                    onToggle={() => setPending(row)}
                    label={row.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={pending !== null}
        title={pending?.isActive ? "Deactivate rate?" : "Activate rate?"}
        message={`"${pending?.name}" will be ${pending?.isActive ? "deactivated" : "activated"}.`}
        confirmLabel={pending?.isActive ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pending?.isActive)}
        onConfirm={confirmToggle}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

export function TaxConfigClient() {
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);

  const loadTaxTypes = () =>
    fetch("/api/v1/tax-types")
      .then((res) => res.json())
      .then((body) => setTaxTypes(body.data ?? []));

  useEffect(() => {
    loadTaxTypes();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Tax Configuration" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Tax Configuration</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Tax types and their effective-dated rates.</p>
      </div>

      <TaxTypesSection rows={taxTypes} onReload={loadTaxTypes} />
      <TaxRatesSection taxTypes={taxTypes} />
    </div>
  );
}

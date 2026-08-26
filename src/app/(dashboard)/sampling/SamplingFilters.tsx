"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { STATUS_LABELS } from "./statusLabels";

export interface SamplingFiltersValue {
  customerId: string;
  buyerId: string;
  styleSearch: string;
  statuses: string[];
  requestedByUserId: string;
  dateFrom: string;
  dateTo: string;
  color: string;
}

export const EMPTY_FILTERS: SamplingFiltersValue = {
  customerId: "",
  buyerId: "",
  styleSearch: "",
  statuses: [],
  requestedByUserId: "",
  dateFrom: "",
  dateTo: "",
  color: "",
};

interface Option {
  id: string;
  name?: string;
  fullName?: string;
}

function countActive(f: SamplingFiltersValue): number {
  return (
    (f.customerId ? 1 : 0) +
    (f.buyerId ? 1 : 0) +
    (f.styleSearch ? 1 : 0) +
    (f.statuses.length > 0 ? 1 : 0) +
    (f.requestedByUserId ? 1 : 0) +
    (f.dateFrom || f.dateTo ? 1 : 0) +
    (f.color ? 1 : 0)
  );
}

// Deliberately reads LOCAL calendar components (never .toISOString(), which
// converts through UTC) — see the identical fix in crm/page.tsx for the full
// explanation (ERP-BUG-0001, Phase 10 QA pass): on IST, .toISOString() made
// "This Month" start one calendar day too early.
function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "Today"/"This Week"/"This Month" presets — "Custom" is just typing directly into the date inputs, no separate mode needed. */
function datePreset(preset: "today" | "week" | "month"): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const to = toIsoDate(now);
  if (preset === "today") return { dateFrom: to, dateTo: to };
  if (preset === "week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    return { dateFrom: toIsoDate(monday), dateTo: to };
  }
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { dateFrom: toIsoDate(firstOfMonth), dateTo: to };
}

export function SamplingFilters({
  value,
  onApply,
  onClearAll,
  isOpen,
  onToggleOpen,
}: {
  value: SamplingFiltersValue;
  onApply: (filters: SamplingFiltersValue) => void;
  onClearAll: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []));
    fetch("/api/v1/users")
      .then((res) => res.json())
      .then((body) => setUsers(body.data ?? []));
  }, []);

  // Resetting `buyers` when the customer is cleared happens in the Customer
  // <select>'s onChange handler itself, not here, to avoid a synchronous
  // setState in the effect body — same pattern as SampleRequestForm.tsx.
  useEffect(() => {
    if (!draft.customerId) return;
    fetch(`/api/v1/customers/${draft.customerId}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  }, [draft.customerId]);

  const activeCount = countActive(value);

  const toggleStatus = (status: string) => {
    setDraft((d) => ({
      ...d,
      statuses: d.statuses.includes(status) ? d.statuses.filter((s) => s !== status) : [...d.statuses, status],
    }));
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        <span>
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </span>
        <span className="text-xs text-zinc-400">{isOpen ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Customer</label>
              <select
                value={draft.customerId}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, customerId: e.target.value, buyerId: "" }));
                  setBuyers([]);
                }}
                className={`${textInputClass()} mt-1`}
              >
                <option value="">— Any —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Buyer</label>
              <select
                value={draft.buyerId}
                onChange={(e) => setDraft((d) => ({ ...d, buyerId: e.target.value }))}
                disabled={!draft.customerId}
                className={`${textInputClass()} mt-1`}
              >
                <option value="">— Any —</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {!draft.customerId && <p className="mt-1 text-xs text-zinc-400">Pick a Customer first.</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Style</label>
              <input
                value={draft.styleSearch}
                onChange={(e) => setDraft((d) => ({ ...d, styleSearch: e.target.value }))}
                placeholder="Search style name…"
                className={`${textInputClass()} mt-1`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Requested By</label>
              <select
                value={draft.requestedByUserId}
                onChange={(e) => setDraft((d) => ({ ...d, requestedByUserId: e.target.value }))}
                className={`${textInputClass()} mt-1`}
              >
                <option value="">— Any —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Color</label>
              <input
                value={draft.color}
                onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                placeholder="Search color…"
                className={`${textInputClass()} mt-1`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Request Date</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="date"
                  value={draft.dateFrom}
                  onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
                  className={textInputClass()}
                />
                <span className="text-xs text-zinc-400">to</span>
                <input
                  type="date"
                  value={draft.dateTo}
                  onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
                  className={textInputClass()}
                />
              </div>
              <div className="mt-1.5 flex gap-1.5">
                {(["today", "week", "month"] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, ...datePreset(preset) }))}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {preset === "today" ? "Today" : preset === "week" ? "This Week" : "This Month"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Status</label>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                  <input type="checkbox" checked={draft.statuses.includes(key)} onChange={() => toggleStatus(key)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => onApply(draft)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                onClearAll();
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Clear All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

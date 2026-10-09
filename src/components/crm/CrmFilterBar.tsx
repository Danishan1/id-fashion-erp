"use client";

import { useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toIsoDate } from "@/lib/date";

/**
 * Definition-driven version of the app's worklist filter panel
 * (UI_RULES.md §1, reference: SamplingFilters): collapsible, closed by
 * default, "Filters (N)" counts *applied* filters, edits are staged in a
 * draft and only take effect on "Apply Filters", and "Clear All" resets
 * without collapsing (open state is owned by the parent).
 *
 * Values are plain strings keyed by query-param name, so applied filters can
 * be passed straight to an API as query params.
 */
export type CrmFilterDefinition =
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[]; anyLabel?: string }
  | { type: "text"; key: string; label: string; placeholder?: string }
  | { type: "dateRange"; label: string; fromKey: string; toKey: string }
  | { type: "numberRange"; label: string; minKey: string; maxKey: string; step?: number };

export type CrmFilterValues = Record<string, string>;

export function crmFilterKeys(definitions: CrmFilterDefinition[]): string[] {
  return definitions.flatMap((d) => (d.type === "dateRange" ? [d.fromKey, d.toKey] : d.type === "numberRange" ? [d.minKey, d.maxKey] : [d.key]));
}

export function countActiveCrmFilters(definitions: CrmFilterDefinition[], values: CrmFilterValues): number {
  return definitions.filter((d) =>
    d.type === "dateRange" ? values[d.fromKey] || values[d.toKey] : d.type === "numberRange" ? values[d.minKey] || values[d.maxKey] : values[d.key]
  ).length;
}

/** Today / This Week (Mon–today) / This Month (1st–today), from LOCAL calendar dates — never toISOString(). */
export function crmDatePreset(preset: "today" | "week" | "month", now = new Date()): { from: string; to: string } {
  const to = toIsoDate(now);
  if (preset === "today") return { from: to, to };
  if (preset === "week") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    return { from: toIsoDate(monday), to };
  }
  return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}

const labelClass = "block text-xs font-medium text-zinc-500 dark:text-zinc-400";

export function CrmFilterBar({
  definitions,
  value,
  onApply,
  onClearAll,
  isOpen,
  onToggleOpen,
}: {
  definitions: CrmFilterDefinition[];
  value: CrmFilterValues;
  onApply: (values: CrmFilterValues) => void;
  onClearAll: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const [draft, setDraft] = useState<CrmFilterValues>(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  const set = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));
  const activeCount = countActiveCrmFilters(definitions, value);

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        <span>Filters{activeCount > 0 ? ` (${activeCount})` : ""}</span>
        <span className="text-xs text-zinc-400">{isOpen ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {definitions.map((d) => {
              if (d.type === "select") {
                return (
                  <div key={d.key}>
                    <label className={labelClass} htmlFor={`crm-filter-${d.key}`}>
                      {d.label}
                    </label>
                    <div className="mt-1">
                      <SearchableSelect
                        id={`crm-filter-${d.key}`}
                        value={draft[d.key] ?? ""}
                        onChange={(v) => set(d.key, v)}
                        options={d.options.map((o) => ({ id: o.value, label: o.label }))}
                        placeholder={`Search ${d.label.toLowerCase()}…`}
                        emptyOptionLabel={d.anyLabel ?? "— Any —"}
                      />
                    </div>
                  </div>
                );
              }
              if (d.type === "text") {
                return (
                  <div key={d.key}>
                    <label className={labelClass} htmlFor={`crm-filter-${d.key}`}>
                      {d.label}
                    </label>
                    <input
                      id={`crm-filter-${d.key}`}
                      value={draft[d.key] ?? ""}
                      onChange={(e) => set(d.key, e.target.value)}
                      placeholder={d.placeholder}
                      className={`${textInputClass()} mt-1`}
                    />
                  </div>
                );
              }
              if (d.type === "numberRange") {
                return (
                  <div key={d.minKey}>
                    <span className={labelClass}>{d.label}</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        step={d.step ?? "any"}
                        aria-label={`${d.label} minimum`}
                        placeholder="Min"
                        value={draft[d.minKey] ?? ""}
                        onChange={(e) => set(d.minKey, e.target.value)}
                        className={textInputClass()}
                      />
                      <span className="text-xs text-zinc-400">to</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step={d.step ?? "any"}
                        aria-label={`${d.label} maximum`}
                        placeholder="Max"
                        value={draft[d.maxKey] ?? ""}
                        onChange={(e) => set(d.maxKey, e.target.value)}
                        className={textInputClass()}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div key={d.fromKey}>

                  <span className={labelClass}>{d.label}</span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="date"
                      aria-label={`${d.label} from`}
                      value={draft[d.fromKey] ?? ""}
                      onChange={(e) => set(d.fromKey, e.target.value)}
                      className={textInputClass()}
                    />
                    <span className="text-xs text-zinc-400">to</span>
                    <input
                      type="date"
                      aria-label={`${d.label} to`}
                      value={draft[d.toKey] ?? ""}
                      onChange={(e) => set(d.toKey, e.target.value)}
                      className={textInputClass()}
                    />
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    {(["today", "week", "month"] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          const { from, to } = crmDatePreset(preset);
                          setDraft((dr) => ({ ...dr, [d.fromKey]: from, [d.toKey]: to }));
                        }}
                        className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {preset === "today" ? "Today" : preset === "week" ? "This Week" : "This Month"}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => onApply(Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== "")))}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({});
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

"use client";

import { useEffect, useState } from "react";

export type ReportFilterFieldType = "date" | "select" | "text";

export interface ReportFilterFieldConfig {
  key: string;
  label: string;
  type: ReportFilterFieldType;
  options?: { value: string; label: string }[];
  /** Fetched client-side; expects `{ data: [...] }` matching this app's standard list-endpoint shape. */
  optionsUrl?: string;
  optionsValueKey?: string;
  optionsLabelKey?: string;
  placeholder?: string;
}

export interface ReportFilterBarProps {
  fields: ReportFilterFieldConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onApply: () => void;
  onReset: () => void;
  includeDateRange?: boolean;
}

function DynamicSelect({ field, value, onChange }: { field: ReportFilterFieldConfig; value: string; onChange: (v: string) => void }) {
  const [options, setOptions] = useState(field.options ?? []);

  useEffect(() => {
    if (!field.optionsUrl) return;
    let cancelled = false;
    fetch(field.optionsUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body) => {
        if (cancelled) return;
        const valueKey = field.optionsValueKey ?? "id";
        const labelKey = field.optionsLabelKey ?? "name";
        const data: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
        setOptions(
          data.map((item) => {
            const record = item as Record<string, unknown>;
            return { value: String(record[valueKey]), label: String(record[labelKey] ?? record[valueKey]) };
          })
        );
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.optionsUrl]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
    >
      <option value="">All {field.label}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function ReportFilterBar({ fields, values, onChange, onApply, onReset, includeDateRange = true }: ReportFilterBarProps) {
  const hasAnyValue = Object.values(values).some((v) => v);

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      {includeDateRange ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Date From
            <input
              type="date"
              value={values.dateFrom ?? ""}
              onChange={(e) => onChange("dateFrom", e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Date To
            <input
              type="date"
              value={values.dateTo ?? ""}
              onChange={(e) => onChange("dateTo", e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </>
      ) : null}

      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-xs text-zinc-500">
          {field.label}
          {field.type === "select" ? (
            <DynamicSelect field={field} value={values[field.key] ?? ""} onChange={(v) => onChange(field.key, v)} />
          ) : (
            <input
              type="text"
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={(e) => onChange(field.key, e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          )}
        </label>
      ))}

      <div className="ml-auto flex items-center gap-2">
        {hasAnyValue ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Reset
          </button>
        ) : null}
        <button
          type="button"
          onClick={onApply}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

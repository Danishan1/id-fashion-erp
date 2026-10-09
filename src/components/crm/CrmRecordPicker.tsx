"use client";

import { useEffect, useRef, useState } from "react";
import { crmRequest } from "./crm-api";
import { textInputClass } from "@/components/ui/FormField";

export interface CrmPickedRecord {
  id: string;
  label: string;
  sublabel?: string | null;
}

/**
 * Server-side search picker for CRM records (companies, contacts, …) — the
 * browser never loads the whole list. `lookupUrl` is a CRM lookup endpoint
 * that accepts ?search=&limit=; `toOption` maps a row to label/sublabel.
 */
export function CrmRecordPicker<T extends { id: string }>({
  id,
  lookupUrl,
  value,
  onChange,
  toOption,
  placeholder,
  disabled,
  invalid,
}: {
  id: string;
  lookupUrl: string;
  value: CrmPickedRecord | null;
  onChange: (record: (CrmPickedRecord & { row?: T }) | null) => void;
  toOption: (row: T) => CrmPickedRecord;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      const sep = lookupUrl.includes("?") ? "&" : "?";
      crmRequest<T[]>(`${lookupUrl}${sep}limit=15${term.trim() ? `&search=${encodeURIComponent(term.trim())}` : ""}`).then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (res.ok) setRows(res.data);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, open, lookupUrl]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
        <span className="min-w-0 truncate">
          <span className="font-medium">{value.label}</span>
          {value.sublabel && <span className="text-xs text-zinc-500"> · {value.sublabel}</span>}
        </span>
        {!disabled && (
          <button type="button" className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange(null)} aria-label={`Clear ${value.label}`}>
            Change
          </button>
        )}
      </div>
    );

  return (
    <div className="relative" ref={box}>
      <input id={id} className={textInputClass(invalid)} value={term} placeholder={placeholder} disabled={disabled} autoComplete="off" onFocus={() => setOpen(true)} onChange={(e) => setTerm(e.target.value)} />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {loading && rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">Searching…</li>
          ) : rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-zinc-500">No matches.</li>
          ) : (
            rows.map((r) => {
              const o = toOption(r);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() => {
                      onChange({ ...o, row: r });
                      setOpen(false);
                      setTerm("");
                    }}
                  >
                    {o.label}
                    {o.sublabel && <span className="text-xs text-zinc-500"> · {o.sublabel}</span>}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

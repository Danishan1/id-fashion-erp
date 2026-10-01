"use client";

import { useEffect, useRef, useState } from "react";

/** "Columns" dropdown: choose which table columns are visible. At least one stays visible. */
export function CrmColumnPicker({
  columns,
  visibleKeys,
  onChange,
}: {
  columns: { key: string; header: string }[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const visible = new Set(visibleKeys);
  const toggle = (key: string) => {
    const next = columns.map((c) => c.key).filter((k) => (k === key ? !visible.has(k) : visible.has(k)));
    if (next.length) onChange(next);
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Columns ({visibleKeys.length})
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800">
              <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} disabled={visible.has(c.key) && visible.size === 1} />
              {c.header}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

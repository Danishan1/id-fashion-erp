"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Debounced free-text search box (250 ms, same as DataTable). Keeps its own
 * text so typing stays responsive; `onChange` fires with the settled value.
 */
export function CrmSearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
  debounceMs = 250,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  debounceMs?: number;
}) {
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // Parent changed it (e.g. "Clear All"): adopt the new value.
    setLastValue(value);
    setText(value);
  }
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChangeRef.current(text.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [text, value, debounceMs]);

  return (
    <input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      className="w-full max-w-sm rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
    />
  );
}

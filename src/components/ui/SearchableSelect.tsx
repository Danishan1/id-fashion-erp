"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { textInputClass } from "./FormField";

export interface SearchableSelectOption {
  id: string;
  label: string;
  /** Optional secondary text shown alongside the label (e.g. a code) and
   * also matched against when searching — e.g. "CUST-00042" for a customer
   * whose label is its name. */
  sublabel?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  id?: string;
  options: SearchableSelectOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Shown as a selectable first row that clears the field back to "" —
   * omit to make the field always require a real selection (no clear row
   * rendered at all). Defaults to "— None —" whenever the field isn't
   * required, matching this app's existing plain-`<select>` convention. */
  emptyOptionLabel?: string | null;
}

function optionText(o: SearchableSelectOption): string {
  return o.sublabel ? `${o.label} (${o.sublabel})` : o.label;
}

/**
 * Generic searchable replacement for a plain flat `<select>` bound to a
 * potentially large list of real records (Customer, Supplier, Style,
 * Employee, Sales Order, ...) — a native `<select>` stops being usable once
 * that list grows into the hundreds. Mirrors MaterialPicker's own search/
 * keyboard/click-outside UX (that component stays as-is for its own
 * category-grouped material picking); this one is the ungrouped, generic
 * sibling every other "pick one record from a fetched list" field can reuse
 * instead of re-implementing its own search UI.
 */
export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Search…",
  required,
  disabled,
  emptyOptionLabel,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const showEmptyOption = emptyOptionLabel !== null && !required;
  const emptyLabel = emptyOptionLabel ?? "— None —";

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((o) => o.label.toLowerCase().includes(query) || (o.sublabel ?? "").toLowerCase().includes(query));
  }, [options, search]);

  // The clear row is only ever shown unfiltered (pinned at the top) — a
  // search term narrows real options, never hides the way back to "None".
  const rowCount = filtered.length + (showEmptyOption ? 1 : 0);

  const openPicker = () => {
    setIsOpen(true);
    setSearch("");
    setHighlightedIndex(0);
  };

  const selectId = (nextId: string) => {
    onChange(nextId);
    setIsOpen(false);
    setSearch("");
  };

  const selectByRowIndex = (rowIndex: number) => {
    if (showEmptyOption && rowIndex === 0) {
      selectId("");
      return;
    }
    const option = filtered[rowIndex - (showEmptyOption ? 1 : 0)];
    if (option && !option.disabled) selectId(option.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openPicker();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setSearch("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, rowCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectByRowIndex(highlightedIndex);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        required={required}
        disabled={disabled}
        value={isOpen ? search : selected ? optionText(selected) : ""}
        placeholder={placeholder}
        onFocus={openPicker}
        onClick={openPicker}
        onChange={(e) => {
          setSearch(e.target.value);
          setHighlightedIndex(0);
          if (!isOpen) setIsOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={textInputClass()}
        autoComplete="off"
      />

      {isOpen && !disabled && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {rowCount === 0 && <p className="px-3 py-2 text-sm text-zinc-500">No matches found.</p>}
          {showEmptyOption && (
            <button
              type="button"
              onClick={() => selectId("")}
              onMouseEnter={() => setHighlightedIndex(0)}
              className={`block w-full px-3 py-2 text-left text-sm ${
                highlightedIndex === 0
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {emptyLabel}
            </button>
          )}
          {filtered.map((o, i) => {
            const rowIndex = i + (showEmptyOption ? 1 : 0);
            return (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled}
                onClick={() => selectId(o.id)}
                onMouseEnter={() => setHighlightedIndex(rowIndex)}
                className={`block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  rowIndex === highlightedIndex
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {o.label}
                {o.sublabel && <span className="text-xs text-zinc-400"> ({o.sublabel})</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

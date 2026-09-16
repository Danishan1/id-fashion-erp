"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchResultItem {
  id: string;
  primary: string;
  secondary: string | null;
  href: string;
}

interface SearchGroup {
  module: string;
  label: string;
  items: SearchResultItem[];
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/**
 * The Topbar's Global Search — a type-ahead dropdown over
 * `GET /api/v1/search?q=`, modeled directly on this app's own two closest
 * existing conventions rather than a new UI pattern: `MaterialPicker.tsx`'s
 * open/close/keyboard-nav/click-outside state machine, and `DataTable.tsx`'s
 * debounced-fetch-with-AbortController shape.
 */
export function GlobalSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  // Debounced fetch, cancelling a still-in-flight previous request the
  // moment a newer keystroke supersedes it — same AbortController + setTimeout
  // shape DataTable.tsx already uses for its own server-side search box. The
  // below-minimum-length reset lives inside the async callback too (not a
  // synchronous early-return in the effect body) — this project's own
  // established fix for the react-hooks/set-state-in-effect rule; it has no
  // visible effect on the UI either way since `showDropdown` already hides
  // the dropdown the instant the query drops below the minimum, independent
  // of when this state actually clears.
  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      if (trimmed.length < MIN_QUERY_LENGTH) {
        setGroups([]);
        setError(null);
        setHasSearched(false);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const url = new URL("/api/v1/search", window.location.origin);
        url.searchParams.set("q", trimmed);
        const res = await fetch(url.toString(), { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Search failed. Please try again.");
        setGroups(body.data?.groups ?? []);
        setHighlightedIndex(0);
        setHasSearched(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed. Please try again.");
        setGroups([]);
        setHasSearched(true);
      } finally {
        setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query]);

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const showDropdown = isOpen && query.trim().length >= MIN_QUERY_LENGTH;

  const navigateTo = (href: string) => {
    setIsOpen(false);
    setQuery("");
    setGroups([]);
    setHasSearched(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatItems.length > 0) setHighlightedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatItems.length > 0) setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const item = flatItems[highlightedIndex];
      if (item) {
        e.preventDefault();
        navigateTo(item.href);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search customers, orders, samples, invoices…"
        aria-label="Global search"
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls="global-search-listbox"
        className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
      />

      {showDropdown && (
        <div
          id="global-search-listbox"
          role="listbox"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          {isLoading && <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">Searching…</p>}

          {!isLoading && error && <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {!isLoading && !error && hasSearched && flatItems.length === 0 && (
            <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">No results for “{query.trim()}”.</p>
          )}

          {!isLoading &&
            !error &&
            groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const flatIndex = flatItems.indexOf(item);
                  const isHighlighted = flatIndex === highlightedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onClick={() => navigateTo(item.href)}
                      onMouseEnter={() => setHighlightedIndex(flatIndex)}
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        isHighlighted ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">{item.primary}</div>
                      {item.secondary && <div className="text-xs text-zinc-500 dark:text-zinc-400">{item.secondary}</div>}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CrmFilterValues } from "./CrmFilterBar";

/**
 * Applied filters + search for a CRM list, mirrored into the page URL
 * (`?eventType=…&from=…&search=…`). That makes every filtered view
 * shareable/bookmarkable and lets dashboards drill down by linking to a
 * list with query params. Only the given keys (+ "search") are read/written;
 * other query params on the page are left alone.
 */
export function useCrmListState(filterKeys: string[], { syncWithUrl = true }: { syncWithUrl?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const keysSignature = filterKeys.join("|");

  const initial = useMemo(() => {
    const values: CrmFilterValues = {};
    if (syncWithUrl) {
      for (const key of keysSignature.split("|").filter(Boolean)) {
        const v = searchParams.get(key);
        if (v) values[key] = v;
      }
    }
    return { values, search: syncWithUrl ? (searchParams.get("search") ?? "") : "" };
    // Initial read only; afterwards this hook owns the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filters, setFilters] = useState<CrmFilterValues>(initial.values);
  const [search, setSearchState] = useState(initial.search);
  const [isFilterPanelOpen, setFilterPanelOpen] = useState(false);

  const writeUrl = useCallback(
    (nextFilters: CrmFilterValues, nextSearch: string) => {
      if (!syncWithUrl) return;
      const params = new URLSearchParams(searchParams.toString());
      for (const key of [...keysSignature.split("|").filter(Boolean), "search"]) params.delete(key);
      for (const [key, value] of Object.entries(nextFilters)) if (value) params.set(key, value);
      if (nextSearch) params.set("search", nextSearch);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [syncWithUrl, searchParams, keysSignature, router, pathname]
  );

  const applyFilters = useCallback(
    (values: CrmFilterValues) => {
      setFilters(values);
      writeUrl(values, search);
    },
    [writeUrl, search]
  );
  const clearFilters = useCallback(() => {
    setFilters({});
    writeUrl({}, search);
  }, [writeUrl, search]);
  const setSearch = useCallback(
    (value: string) => {
      setSearchState(value);
      writeUrl(filters, value);
    },
    [writeUrl, filters]
  );
  /** Replace filters and search at once (e.g. applying a saved view). */
  const replaceAll = useCallback(
    (values: CrmFilterValues, nextSearch: string) => {
      setFilters(values);
      setSearchState(nextSearch);
      writeUrl(values, nextSearch);
    },
    [writeUrl]
  );

  return {
    filters,
    search,
    applyFilters,
    clearFilters,
    setSearch,
    replaceAll,
    isFilterPanelOpen,

    toggleFilterPanel: () => setFilterPanelOpen((o) => !o),
  };
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";
import { EMPTY_FILTERS, SamplingFilters, type SamplingFiltersValue } from "./SamplingFilters";
import { SAMPLE_TYPE_LABELS } from "./sampleTypeLabels";

interface SampleRequestRow {
  id: string;
  requestNumber: string;
  styleName: string | null;
  sampleType: keyof typeof SAMPLE_TYPE_LABELS | null;
  status: keyof typeof STATUS_LABELS;
  requestDate: string;
  customer: { name: string } | null;
  buyer: { name: string } | null;
  product: { styleName: string } | null;
  requestedBy: { fullName: string } | null;
}

interface ListResponse {
  data: SampleRequestRow[];
  meta: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

type SortBy = "requestDate" | "status" | "customer" | "buyer" | "styleName";

const SORT_COLUMNS: { key: SortBy; header: string }[] = [
  { key: "customer", header: "Customer" },
  { key: "buyer", header: "Buyer" },
  { key: "styleName", header: "Style" },
  { key: "status", header: "Status" },
  { key: "requestDate", header: "Request Date" },
];

export function SamplingListClient() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SamplingFiltersValue>(EMPTY_FILTERS);
  // SamplingFilters' internal `draft` state only initializes on mount — bump
  // this to force a remount (and re-initialize the draft from the now-empty
  // filters) after Clear All, same remount-via-key convention used elsewhere
  // in this app for resetting state a plain effect shouldn't own.
  const [filtersResetKey, setFiltersResetKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>("requestDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [result, setResult] = useState<ListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = new URL("/api/v1/sampling", window.location.origin);
        url.searchParams.set("page", String(page));
        url.searchParams.set("sortBy", sortBy);
        url.searchParams.set("sortOrder", sortOrder);
        if (search) url.searchParams.set("search", search);
        if (filters.customerId) url.searchParams.set("customerId", filters.customerId);
        if (filters.buyerId) url.searchParams.set("buyerId", filters.buyerId);
        if (filters.styleSearch) url.searchParams.set("styleSearch", filters.styleSearch);
        if (filters.statuses.length > 0) url.searchParams.set("status", filters.statuses.join(","));
        if (filters.requestedByUserId) url.searchParams.set("requestedByUserId", filters.requestedByUserId);
        if (filters.dateFrom) url.searchParams.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) url.searchParams.set("dateTo", filters.dateTo);
        if (filters.color) url.searchParams.set("color", filters.color);

        const res = await fetch(url.toString(), { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load sample requests.");
        setResult(body);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [search, filters, page, sortBy, sortOrder]);

  const toggleSort = (key: SortBy) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const colSpan = SORT_COLUMNS.length + 4; // Request #, Type, Requested By, Actions

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sampling" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Sampling</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sample requests from customer ask through tech pack, development, and customer approval.
          </p>
        </div>
        <Link
          href="/sampling/new"
          className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New Sample Request
        </Link>
      </div>

      <input
        type="search"
        placeholder="Search by request number…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="w-full max-w-sm rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
      />

      <SamplingFilters
        key={filtersResetKey}
        value={filters}
        isOpen={filtersOpen}
        onToggleOpen={() => setFiltersOpen((o) => !o)}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
        }}
        onClearAll={() => {
          setFilters(EMPTY_FILTERS);
          setFiltersResetKey((k) => k + 1);
          setPage(1);
        }}
      />

      {result && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {result.meta.totalCount} sample request{result.meta.totalCount === 1 ? "" : "s"} found
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-2 font-medium">Request #</th>
              <th className="px-4 py-2 font-medium">Type</th>
              {SORT_COLUMNS.map((col) => (
                <th key={col.key} className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {col.header}
                    {sortBy === col.key && <span>{sortOrder === "asc" ? "▲" : "▼"}</span>}
                  </button>
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Requested By</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-6 text-center text-red-600 dark:text-red-400">
                  {error}
                </td>
              </tr>
            )}
            {!error && isLoading && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {!error && !isLoading && result?.data.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-6 text-center text-zinc-500">
                  No sample requests match these filters.
                </td>
              </tr>
            )}
            {!error &&
              !isLoading &&
              result?.data.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{row.requestNumber}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                    {row.sampleType ? SAMPLE_TYPE_LABELS[row.sampleType] : "Not specified"}
                  </td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{row.customer?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{row.buyer?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                    {row.styleName ?? row.product?.styleName ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                    {new Date(row.requestDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{row.requestedBy?.fullName ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Link href={`/sampling/${row.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {result && result.meta.totalCount > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Showing {(result.meta.page - 1) * result.meta.pageSize + 1}–
            {Math.min(result.meta.page * result.meta.pageSize, result.meta.totalCount)} of {result.meta.totalCount}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(result.meta.totalPages, p + 1))}
              disabled={page >= result.meta.totalPages}
              className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

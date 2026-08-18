"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  fetchUrl: string;
  columns: DataTableColumn<T>[];
  rowHref?: (row: T) => string;
  newHref?: string;
  newLabel?: string;
  searchPlaceholder?: string;
  /** Bump to force a refetch (e.g. after an external mutation). */
  refreshKey?: number;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

export function DataTable<T extends { id: string }>({
  fetchUrl,
  columns,
  rowHref,
  newHref,
  newLabel = "New",
  searchPlaceholder = "Search…",
  refreshKey,
}: DataTableProps<T>) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<ListResponse<T> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggleRow, setPendingToggleRow] = useState<T | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = new URL(fetchUrl, window.location.origin);
        url.searchParams.set("page", String(page));
        if (search) url.searchParams.set("search", search);

        const res = await fetch(url.toString(), { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load data.");
        setResult(body);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchUrl, page, search, refreshKey, reloadTick]);

  const rowIsActive = (row: T): boolean | undefined => (row as { isActive?: boolean }).isActive;

  const rowLabel = (row: T): string => {
    const r = row as Record<string, unknown>;
    return String(r.name ?? r.styleName ?? r.fullName ?? r.code ?? "this record");
  };

  const confirmToggleActive = async () => {
    if (!pendingToggleRow) return;
    setIsToggling(true);
    await fetch(`${fetchUrl}/${pendingToggleRow.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rowIsActive(pendingToggleRow) }),
    });
    setIsToggling(false);
    setPendingToggleRow(null);
    setReloadTick((t) => t + 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full max-w-sm rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
        />
        {newHref && (
          <Link
            href={newHref}
            className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {newLabel}
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-2 font-medium">
                  {col.header}
                </th>
              ))}
              {rowHref && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={columns.length + (rowHref ? 1 : 0)} className="px-4 py-6 text-center text-red-600 dark:text-red-400">
                  {error}
                </td>
              </tr>
            )}
            {!error && isLoading && (
              <tr>
                <td colSpan={columns.length + (rowHref ? 1 : 0)} className="px-4 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {!error && !isLoading && result?.data.length === 0 && (
              <tr>
                <td colSpan={columns.length + (rowHref ? 1 : 0)} className="px-4 py-6 text-center text-zinc-500">
                  No records found.
                </td>
              </tr>
            )}
            {!error &&
              !isLoading &&
              result?.data.map((row) => {
                const href = rowHref?.(row);
                const cells = columns.map((col) => (
                  <td key={col.key} className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                  </td>
                ));
                const isActive = rowIsActive(row);
                return (
                  <tr
                    key={row.id}
                    onClick={href ? () => router.push(href) : undefined}
                    tabIndex={href ? 0 : undefined}
                    onKeyDown={
                      href
                        ? (e) => {
                            if (e.key === "Enter") router.push(href);
                          }
                        : undefined
                    }
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${
                      href ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : ""
                    }`}
                  >
                    {cells}
                    {rowHref && (
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Link
                            href={href!}
                            onClick={(e: MouseEvent) => e.stopPropagation()}
                            className="font-medium text-indigo-600 hover:text-indigo-500"
                          >
                            Edit
                          </Link>
                          {isActive !== undefined && (
                            <ToggleSwitch
                              checked={isActive}
                              onToggle={() => setPendingToggleRow(row)}
                              label={isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
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

      <ConfirmModal
        open={pendingToggleRow !== null}
        title={pendingToggleRow && rowIsActive(pendingToggleRow) ? "Deactivate record?" : "Activate record?"}
        message={
          pendingToggleRow && rowIsActive(pendingToggleRow)
            ? `"${rowLabel(pendingToggleRow)}" will be deactivated and hidden from active selection lists. You can reactivate it later.`
            : `"${pendingToggleRow ? rowLabel(pendingToggleRow) : ""}" will be marked active again.`
        }
        confirmLabel={pendingToggleRow && rowIsActive(pendingToggleRow) ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pendingToggleRow && rowIsActive(pendingToggleRow))}
        isBusy={isToggling}
        onConfirm={confirmToggleActive}
        onCancel={() => setPendingToggleRow(null)}
      />
    </div>
  );
}

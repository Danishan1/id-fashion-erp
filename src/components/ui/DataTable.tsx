"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Button, buttonClasses } from "@/components/ui/Button";
import { RowAction } from "@/components/ui/RowAction";
import { EditIcon } from "@/components/ui/icons";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /**
   * Opt-in column sorting (audit item #7) — set only on a column whose `key`
   * is a genuine flat scalar field on the underlying Prisma model, since it's
   * sent to the server as-is (`?sortBy=<key>&sortOrder=asc|desc`) and every
   * list service already does a generic `orderBy: { [query.sortBy]:
   * query.sortOrder }` pass-through (see src/lib/list-query.ts). Never set
   * this on a computed/relation column (e.g. a joined "category.name" cell)
   * — the server has no such flat field to sort by. Purely additive: a
   * column with no `sortable` renders exactly as before, and the table
   * sends no sort params at all until a user actually clicks a sortable
   * header, so the server's own existing default order is unaffected.
   */
  sortable?: boolean;
}

interface DataTableProps<T> {
  fetchUrl: string;
  columns: DataTableColumn<T>[];
  rowHref?: (row: T) => string;
  /**
   * Overrides the built-in row-click affordance's label/icon — defaults to
   * "Edit"/EditIcon (every existing caller's real behavior, unchanged).
   * Applies to BOTH rowHref and onEditRow (they're mutually exclusive — see
   * onEditRow's own doc below) — the same override, since either way it's
   * describing the same "what does clicking this row's action actually do"
   * fact. Set this when the destination/modal is read-only (e.g. a
   * history/detail view or a view-only lookup rather than an edit form), so
   * the Actions column doesn't claim an action ("Edit") that isn't real —
   * see /bom-mrp's Design BOM tab, which opens a view-only modal.
   */
  rowHrefLabel?: string;
  rowHrefIcon?: ReactNode;
  newHref?: string;
  newLabel?: string;
  /**
   * Alternative to newHref for a module whose "New" form is a modal rather
   * than a separate route — renders as the same-styled button, calling
   * onClick instead of navigating. Takes precedence over newHref if both are
   * somehow provided.
   */
  newAction?: { label: string; onClick: () => void };
  searchPlaceholder?: string;
  /** Bump to force a refetch (e.g. after an external mutation). */
  refreshKey?: number;
  /**
   * When given, renders a "Download Excel" link next to the New button —
   * the module's own `/export/xlsx` API route (e.g.
   * "/api/v1/sales-orders/export/xlsx"). A plain `<a>`, not wired to the
   * table's own live search/page state — it always exports the full,
   * server-side-capped list, matching every other export link in this app
   * (Products, Stock Balances, Job Work Orders).
   */
  exportUrl?: string;
  /**
   * Extra per-row action(s) rendered in the Actions column, between the
   * built-in Edit link and the Active/Inactive toggle — for a module-specific
   * action that doesn't warrant its own DataTable column (e.g. Suppliers'
   * "Categories"/"Materials" catalog buttons). Clicks inside this area never
   * trigger the row's own click-to-edit navigation.
   */
  rowActions?: (row: T) => ReactNode;
  /**
   * Alternative to rowHref for a module with no detail page to navigate to —
   * renders the built-in "Edit" affordance as a button that opens a modal
   * (the caller owns the modal/fetch/submit) instead of a Link, and the row
   * itself is not click-to-navigate. Ignored if rowHref is also provided.
   */
  onEditRow?: (row: T) => void;
  /**
   * Renders a "Status" <select> next to the search box — selecting a value
   * appends it as a query param on fetchUrl (default param name "status",
   * matching list-query.ts's own generic `?status=` parsing) and resets to
   * page 1. Purely additive: a table with no statusFilter behaves exactly as
   * before. The caller supplies real enum values/labels (this component has
   * no knowledge of any model's status enum) — the same "server validates,
   * this is just a convenience trigger" split already used everywhere else
   * a status filter exists in this app.
   */
  statusFilter?: {
    options: { value: string; label: string }[];
    paramName?: string;
    /** Defaults to "All Statuses". */
    allLabel?: string;
    /** Pre-selected value (e.g. from a dashboard click-through link). Only
     * read on mount — callers that change it should remount via `key`. */
    initialValue?: string;
  };
  /**
   * Extra query params sent with every fetch (blank values are skipped) —
   * lets a wrapper such as CrmTable drive several filters at once. Changing
   * any value resets to page 1. Purely additive: omitted, nothing changes.
   */
  extraParams?: Record<string, string | undefined>;
  /** Hide the built-in search box (when a wrapper renders its own search and passes it via extraParams.search). */
  hideSearch?: boolean;
  /** Extra controls rendered in the toolbar row, after the search box. */
  toolbar?: ReactNode;
  /**
   * Adds a leading checkbox column for bulk actions. The header checkbox
   * selects / clears the rows on the current page. Selection is owned by the
   * caller (kept across pages). Omitted: no checkbox column, as before.
   */
  selection?: { selectedIds: string[]; onChange: (ids: string[]) => void; label?: (row: T) => string };
  /** Starting sort (e.g. from a saved view). Change via `key` to re-apply. */
  initialSort?: { sortBy: string; sortOrder: "asc" | "desc" };
  /** Told whenever the user changes the sort by clicking a header. */
  onSortChange?: (sort: { sortBy: string; sortOrder: "asc" | "desc" }) => void;
  /**
   * Optional inline expandable row renderer (e.g. for showing line items / breakdown).
   * When provided, a toggle chevron column is rendered at the start of each row.
   */
  renderExpandedRow?: (row: T) => ReactNode;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalCount: number; totalPages: number };
}

export function DataTable<T extends { id: string }>({
  fetchUrl,
  columns,
  rowHref,
  rowHrefLabel = "Edit",
  rowHrefIcon = <EditIcon />,
  newHref,
  newLabel = "New",
  newAction,
  searchPlaceholder = "Search…",
  refreshKey,
  rowActions,
  onEditRow,
  exportUrl,
  statusFilter,
  extraParams,
  hideSearch = false,
  toolbar,
  selection,
  initialSort,
  onSortChange,
  renderExpandedRow,
}: DataTableProps<T>) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusValue, setStatusValue] = useState(statusFilter?.initialValue ?? "");
  const [result, setResult] = useState<ListResponse<T> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingToggleRow, setPendingToggleRow] = useState<T | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());

  const toggleRowExpansion = (id: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Undefined until a user actually clicks a sortable header — the request
  // then carries no sortBy/sortOrder params at all, so every page's existing
  // default server-side order is completely unaffected until opted into.
  const [sortBy, setSortBy] = useState<string | undefined>(initialSort?.sortBy);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(initialSort?.sortOrder ?? "asc");

  // A stable string key, so a new-but-equal extraParams object (re-created on
  // every parent render) never triggers a refetch on its own.
  const extraParamsKey = JSON.stringify(
    Object.entries(extraParams ?? {})
      .filter(([, v]) => v !== undefined && v !== "")
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const [lastExtraParamsKey, setLastExtraParamsKey] = useState(extraParamsKey);
  if (lastExtraParamsKey !== extraParamsKey) {
    // Adjust state during render (React's documented pattern) rather than in
    // an effect, so the fetch below never runs once with the stale page.
    setLastExtraParamsKey(extraParamsKey);
    setPage(1);
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = new URL(fetchUrl, window.location.origin);
        url.searchParams.set("page", String(page));
        if (search) url.searchParams.set("search", search);
        if (sortBy) {
          url.searchParams.set("sortBy", sortBy);
          url.searchParams.set("sortOrder", sortOrder);
        }
        if (statusFilter && statusValue) {
          url.searchParams.set(statusFilter.paramName ?? "status", statusValue);
        }
        for (const [key, value] of JSON.parse(extraParamsKey) as [string, string][]) {
          url.searchParams.set(key, value);
        }

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
  }, [fetchUrl, page, search, refreshKey, reloadTick, sortBy, sortOrder, statusFilter, statusValue, extraParamsKey]);

  const actionsColCount =
    (rowHref || onEditRow || rowActions ? 1 : 0) + (selection ? 1 : 0) + (renderExpandedRow ? 1 : 0);

  const toggleSort = (key: string) => {
    const next = sortBy === key ? { sortBy: key, sortOrder: sortOrder === "asc" ? ("desc" as const) : ("asc" as const) } : { sortBy: key, sortOrder: "asc" as const };
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
    setPage(1);
    onSortChange?.(next);
  };

  const pageIds = result?.data.map((r) => r.id) ?? [];
  const selectedSet = new Set(selection?.selectedIds ?? []);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));
  const somePageSelected = pageIds.some((id) => selectedSet.has(id));
  const togglePage = () => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (allPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    selection.onChange([...next]);
  };
  const toggleRow = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange([...next]);
  };

  // The exact same element renders in the header's own toolbar AND (only
  // when the table is genuinely empty, see below) as the empty state's own
  // call-to-action — one definition so the two can never visually drift.
  const newButton = newAction ? (
    <Button onClick={newAction.onClick}>{newAction.label}</Button>
  ) : newHref ? (
    <Link href={newHref} className={buttonClasses("primary", "sm")}>
      {newLabel}
    </Link>
  ) : null;

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
        {!hideSearch && (
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
        )}
        {toolbar}
        {statusFilter && (
          <select
            aria-label="Filter by status"
            value={statusValue}
            onChange={(e) => {
              setStatusValue(e.target.value);
              setPage(1);
            }}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">{statusFilter.allLabel ?? "All Statuses"}</option>
            {statusFilter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {exportUrl && (
            <a href={exportUrl} className={buttonClasses("secondary", "sm")}>
              Download Excel
            </a>
          )}
          {newButton}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {renderExpandedRow && (
                <th className="w-8 px-2 py-2 text-center" aria-label="Expand row" />
              )}
              {selection && (
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allPageSelected && somePageSelected;
                    }}
                    onChange={togglePage}
                    disabled={pageIds.length === 0}
                  />
                </th>
              )}
              {columns.map((col) =>
                col.sortable ? (
                  <th
                    key={col.key}
                    className="px-4 py-2 font-medium"
                    aria-sort={sortBy === col.key ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:hover:text-zinc-200 dark:focus-visible:ring-offset-zinc-900"
                    >
                      {col.header}
                      {sortBy === col.key && <span aria-hidden="true">{sortOrder === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ) : (
                  <th key={col.key} className="px-4 py-2 font-medium">
                    {col.header}
                  </th>
                )
              )}
              {(rowHref || onEditRow || rowActions) && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {error && (
              <tr>
                <td colSpan={columns.length + actionsColCount} className="px-4 py-8 text-center">
                  <div className="space-y-3">
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                      {error}
                    </p>
                    <Button variant="secondary" onClick={() => setReloadTick((t) => t + 1)}>
                      Retry
                    </Button>
                  </div>
                </td>
              </tr>
            )}
            {!error && isLoading && (
              <tr>
                <td colSpan={columns.length + actionsColCount} className="px-4 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {!error && !isLoading && result?.data.length === 0 && (
              <tr>
                <td colSpan={columns.length + actionsColCount} className="px-4 py-8 text-center">
                  {search.trim() || statusValue || extraParamsKey !== "[]" ? (
                    <p className="text-sm text-zinc-500">No records match your search or filter.</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm text-zinc-500">No records found.</p>
                      {newButton && <p className="text-sm text-zinc-500">Create your first one to get started.</p>}
                      <div className="pt-2">{newButton}</div>
                    </div>
                  )}
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
                const isExpanded = expandedRowIds.has(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr
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
                      {renderExpandedRow && (
                        <td className="w-8 px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleRowExpansion(row.id)}
                            aria-label={isExpanded ? "Collapse row" : "Expand row"}
                            aria-expanded={isExpanded}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          >
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>
                      )}
                      {selection && (
                        <td className="w-10 px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${selection.label ? selection.label(row) : rowLabel(row)}`}
                            checked={selectedSet.has(row.id)}
                            onChange={() => toggleRow(row.id)}
                          />
                        </td>
                      )}
                      {cells}
                      {(rowHref || onEditRow || rowActions) && (
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            {rowHref ? (
                              <RowAction icon={rowHrefIcon} label={rowHrefLabel} href={href!} />
                            ) : onEditRow ? (
                              <RowAction icon={rowHrefIcon} label={rowHrefLabel} onClick={() => onEditRow(row)} />
                            ) : null}
                            {rowActions && (
                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                {rowActions(row)}
                              </div>
                            )}
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
                    {renderExpandedRow && isExpanded && (
                      <tr key={`${row.id}-expanded`} className="border-b border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-800/40">
                        <td colSpan={columns.length + actionsColCount} className="p-0">
                          <div className="border-l-4 border-indigo-500 px-6 py-3">
                            {renderExpandedRow(row)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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

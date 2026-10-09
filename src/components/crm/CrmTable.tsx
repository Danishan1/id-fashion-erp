"use client";

import type { ReactNode } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { ViewIcon } from "@/components/ui/icons";
import { CrmFilterBar, crmFilterKeys, type CrmFilterDefinition } from "./CrmFilterBar";
import { CrmSearchInput } from "./CrmSearchInput";
import { useCrmListState } from "./useCrmListState";

export type CrmListState = ReturnType<typeof useCrmListState>;

/**
 * Standard CRM list: debounced search + (optional) collapsible filter panel
 * on top of the app's shared DataTable, so pagination, sorting, the
 * "Loading…"/"No records found." states and the row-action column behave
 * exactly like every other list in the ERP. Applied filters and search are
 * sent to `fetchUrl` as query params and mirrored into the page URL.
 *
 * Row click: `rowHref` navigates to a detail page; `onRowClick` (e.g. open a
 * CrmDrawer) is used when there is no page. Only one of the two is used.
 * Pass `listState` (from useCrmListState) when the page needs to drive the
 * filters itself, e.g. to apply a saved view.
 */
export function CrmTable<T extends { id: string }>({
  fetchUrl,
  columns,
  filters = [],
  searchPlaceholder = "Search…",
  rowHref,
  onRowClick,
  rowActionLabel = "View",
  rowActions,
  newHref,
  newLabel,
  newAction,
  exportUrl,
  refreshKey,
  syncWithUrl = true,
  toolbar,
  listState,
  selection,
  initialSort,
  onSortChange,
  tableKey,
  aboveTable,
}: {
  fetchUrl: string;
  columns: DataTableColumn<T>[];
  filters?: CrmFilterDefinition[];
  searchPlaceholder?: string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowActionLabel?: string;
  rowActions?: (row: T) => ReactNode;
  newHref?: string;
  newLabel?: string;
  newAction?: { label: string; onClick: () => void };
  exportUrl?: string;
  refreshKey?: number;
  syncWithUrl?: boolean;
  toolbar?: ReactNode;
  listState?: CrmListState;
  selection?: { selectedIds: string[]; onChange: (ids: string[]) => void; label?: (row: T) => string };
  initialSort?: { sortBy: string; sortOrder: "asc" | "desc" };
  onSortChange?: (sort: { sortBy: string; sortOrder: "asc" | "desc" }) => void;
  /** Change to remount the table (e.g. after applying a saved view's sort). */
  tableKey?: string;
  /** Rendered between the filter panel and the table (e.g. a bulk-action bar). */
  aboveTable?: ReactNode;
}) {
  const ownState = useCrmListState(crmFilterKeys(filters), { syncWithUrl });
  const state = listState ?? ownState;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <CrmSearchInput value={state.search} onChange={state.setSearch} placeholder={searchPlaceholder} />
        {toolbar}
      </div>
      {filters.length > 0 && (
        <CrmFilterBar
          definitions={filters}
          value={state.filters}
          onApply={state.applyFilters}
          onClearAll={state.clearFilters}
          isOpen={state.isFilterPanelOpen}
          onToggleOpen={state.toggleFilterPanel}
        />
      )}
      {aboveTable}
      <DataTable<T>
        key={tableKey}
        fetchUrl={fetchUrl}
        columns={columns}
        hideSearch
        extraParams={{ ...state.filters, search: state.search }}
        rowHref={rowHref}
        onEditRow={rowHref ? undefined : onRowClick}
        rowHrefLabel={rowActionLabel}
        rowHrefIcon={<ViewIcon />}
        rowActions={rowActions}
        newHref={newHref}
        newLabel={newLabel}
        newAction={newAction}
        exportUrl={exportUrl}
        refreshKey={refreshKey}
        selection={selection}
        initialSort={initialSort}
        onSortChange={onSortChange}
      />
    </div>
  );
}

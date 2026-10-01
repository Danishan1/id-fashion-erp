"use client";

import type { ReactNode } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { ViewIcon } from "@/components/ui/icons";
import { CrmFilterBar, crmFilterKeys, type CrmFilterDefinition } from "./CrmFilterBar";
import { CrmSearchInput } from "./CrmSearchInput";
import { useCrmListState } from "./useCrmListState";

/**
 * Standard CRM list: debounced search + (optional) collapsible filter panel
 * on top of the app's shared DataTable, so pagination, sorting, the
 * "Loading…"/"No records found." states and the row-action column behave
 * exactly like every other list in the ERP. Applied filters and search are
 * sent to `fetchUrl` as query params and mirrored into the page URL.
 *
 * Row click: `rowHref` navigates to a detail page; `onRowClick` (e.g. open a
 * CrmDrawer) is used when there is no page. Only one of the two is used.
 */
export function CrmTable<T extends { id: string }>({
  fetchUrl,
  columns,
  filters = [],
  searchPlaceholder = "Search…",
  rowHref,
  onRowClick,
  rowActionLabel = "View",
  newHref,
  newLabel,
  newAction,
  exportUrl,
  refreshKey,
  syncWithUrl = true,
  toolbar,
}: {
  fetchUrl: string;
  columns: DataTableColumn<T>[];
  filters?: CrmFilterDefinition[];
  searchPlaceholder?: string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowActionLabel?: string;
  newHref?: string;
  newLabel?: string;
  newAction?: { label: string; onClick: () => void };
  exportUrl?: string;
  refreshKey?: number;
  syncWithUrl?: boolean;
  toolbar?: ReactNode;
}) {
  const state = useCrmListState(crmFilterKeys(filters), { syncWithUrl });

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
      <DataTable<T>
        fetchUrl={fetchUrl}
        columns={columns}
        hideSearch
        extraParams={{ ...state.filters, search: state.search }}
        rowHref={rowHref}
        onEditRow={rowHref ? undefined : onRowClick}
        rowHrefLabel={rowActionLabel}
        rowHrefIcon={<ViewIcon />}
        newHref={newHref}
        newLabel={newLabel}
        newAction={newAction}
        exportUrl={exportUrl}
        refreshKey={refreshKey}
      />
    </div>
  );
}

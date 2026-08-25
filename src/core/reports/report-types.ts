/**
 * Shared shape every report in this module returns. One descriptor-builder
 * function per report is called identically by the on-screen JSON route and
 * every export route (xlsx/csv/pdf) — this is what guarantees a report's
 * screen total always matches its exported total, not the routing style.
 * See CLAUDE.md's Phase 9 section for the full rationale.
 */
export type ReportColumnType = "text" | "number" | "currency" | "date" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  type?: ReportColumnType;
  /** Optional client-side drill-down link builder key, e.g. "salesOrder" -> /sales-orders/:id. Resolved by ReportTable using row[linkKey ?? `${key}Id`]. */
  linkTo?: string;
}

export interface ReportFilterApplied {
  label: string;
  value: string;
}

export interface ReportDescriptor {
  title: string;
  subtitle?: string;
  companyName?: string;
  filtersApplied: ReportFilterApplied[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** Always computed over the FULL filtered set server-side, never just the current page. */
  totals?: Record<string, unknown>;
  /** Present only for paginated registers/ledgers. */
  meta?: { page: number; pageSize: number; totalCount: number };
  generatedAt: string;
  generatedByName: string;
  /** For reports whose data is genuinely unavailable (schema gap) rather than empty. */
  unavailableReason?: string;
}

export interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

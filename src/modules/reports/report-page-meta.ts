/**
 * Client-safe report page metadata — deliberately zero imports from Prisma or
 * any server-only module, so this can be imported directly into the "use
 * client" generic report detail page. The heavy data-fetching side (registry.ts
 * + buildDescriptor) stays server-only and is never imported here.
 */
import type { ReactNode } from "react";
import type { ReportFilterFieldConfig } from "@/components/reports/ReportFilterBar";
import type { ReportDescriptor } from "@/core/reports/report-types";

export interface ReportPageMeta {
  category: string;
  key: string;
  title: string;
  description?: string;
  filterFields?: ReportFilterFieldConfig[];
  includeDateRange?: boolean;
  defaultFilters?: Record<string, string>;
  linkBuilders?: Record<string, (row: Record<string, unknown>) => string | undefined>;
  renderKpis?: (descriptor: ReportDescriptor) => ReactNode;
}

const PAGE_META = new Map<string, ReportPageMeta>();

function metaKey(category: string, key: string): string {
  return `${category}/${key}`;
}

export function registerReportPageMeta(meta: ReportPageMeta): void {
  PAGE_META.set(metaKey(meta.category, meta.key), meta);
}

export function getReportPageMeta(category: string, key: string): ReportPageMeta | undefined {
  return PAGE_META.get(metaKey(category, key));
}

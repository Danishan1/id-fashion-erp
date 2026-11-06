import type { ReportDescriptor } from "@/core/reports/report-types";
import type { ReportCategory } from "@/core/reports/permissions";

export interface ReportViewer {
  userId: string;
}

export interface ReportConfig {
  category: ReportCategory;
  key: string;
  title: string;
  /** Called identically by the JSON view route and every export route — the single source of truth for a report's data. */
  /**
   * `viewer` (S&M S6, 2026-11-02) lets a report apply the viewer's own record
   * visibility (e.g. quotations: own / team vs view_all). Existing reports
   * ignore it.
   */
  buildDescriptor: (companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer) => Promise<ReportDescriptor>;
  pdfOrientation?: "portrait" | "landscape";
}

const REGISTRY = new Map<string, ReportConfig>();

function registryKey(category: string, key: string): string {
  return `${category}/${key}`;
}

export function registerReport(config: ReportConfig): void {
  const registryKeyValue = registryKey(config.category, config.key);
  if (REGISTRY.has(registryKeyValue)) {
    throw new Error(`Duplicate report registration: ${registryKeyValue}`);
  }
  REGISTRY.set(registryKeyValue, config);
}

export function getReportConfig(category: string, key: string): ReportConfig | undefined {
  return REGISTRY.get(registryKey(category, key));
}

export function listReportConfigs(): ReportConfig[] {
  return [...REGISTRY.values()];
}

export function listReportConfigsForCategory(category: string): ReportConfig[] {
  return [...REGISTRY.values()].filter((c) => c.category === category);
}

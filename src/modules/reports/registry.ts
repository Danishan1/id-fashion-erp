import type { ReportDescriptor } from "@/core/reports/report-types";
import type { ReportCategory } from "@/core/reports/permissions";

export interface ReportConfig {
  category: ReportCategory;
  key: string;
  title: string;
  /** Called identically by the JSON view route and every export route — the single source of truth for a report's data. */
  buildDescriptor: (companyId: string, generatedByName: string, filters: Record<string, string>) => Promise<ReportDescriptor>;
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

import { z } from "zod";
import { LEAD_SOURCES } from "@/modules/crm/lead.schema";

export const IMPORT_BATCH_TYPES = ["LEAD", "DEAL", "CAMPAIGN_DAILY_METRIC"] as const;
export type ImportBatchTypeValue = (typeof IMPORT_BATCH_TYPES)[number];

// One canonical column spec per import type — the single source of truth
// shared by the server-side row validator below AND the client-side
// column-mapping UI / downloadable template (CsvImportModal reads the same
// `key`/`label`/`required` shape, so the two can never silently drift).
export interface ImportColumnSpec {
  key: string;
  label: string;
  required: boolean;
}

export const IMPORT_COLUMNS: Record<ImportBatchTypeValue, ImportColumnSpec[]> = {
  LEAD: [
    { key: "name", label: "Name", required: true },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "companyName", label: "Company Name", required: false },
    { key: "source", label: `Source (${LEAD_SOURCES.join("/")})`, required: false },
    { key: "leadScore", label: "Lead Score (0-100)", required: false },
    { key: "value", label: "Potential Value", required: false },
    { key: "expectedCloseDate", label: "Expected Close Date (YYYY-MM-DD)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  DEAL: [
    { key: "title", label: "Deal Title", required: true },
    { key: "leadNumber", label: "Lead # (optional link)", required: false },
    { key: "customerCode", label: "Customer Code (optional link)", required: false },
    { key: "value", label: "Value", required: false },
    { key: "probabilityPercent", label: "Probability % (0-100)", required: false },
    { key: "expectedCloseDate", label: "Expected Close Date (YYYY-MM-DD)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  CAMPAIGN_DAILY_METRIC: [
    { key: "campaignNumber", label: "Campaign # (e.g. CAM-2026-00001)", required: false },
    { key: "campaignName", label: "Campaign Name (used only if Campaign # is blank)", required: false },
    { key: "metricDate", label: "Metric Date (YYYY-MM-DD)", required: true },
    { key: "spend", label: "Spend", required: false },
    { key: "impressions", label: "Impressions", required: false },
    { key: "clicks", label: "Clicks", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
};

// Deliberately no separate per-row Zod schema here — import.service.ts
// validates each row by feeding it straight into the exact same
// createLeadSchema/createDealSchema/recordDailyMetricSchema the manual UI
// forms already use, so a CSV-imported record can never diverge from a
// manually-created one's validation rules.

export const runImportSchema = z.object({
  importType: z.enum(IMPORT_BATCH_TYPES),
  fileName: z.string().min(1).max(255),
  // Already column-mapped client-side into canonical keys — every value is
  // still a raw string (as read from the CSV cell); per-row Zod coercion
  // happens server-side, never trusted from the client.
  rows: z.array(z.record(z.string(), z.string())).min(1, "The file has no data rows.").max(5000, "A single import is capped at 5000 rows."),
});
export type RunImportInput = z.infer<typeof runImportSchema>;

import { z } from "zod";

/**
 * AI Designer Tech Pack, "master prompt" flow (2026-09-28) — the structured
 * garment analysis (categories A–J of the company's own "GARMENT TECH PACK
 * SPEC SHEET GENERATOR" master prompt). The AI returns ONLY this analysis;
 * the 7 page image prompts are then built from it in code
 * (page-prompts.ts), so every page is guaranteed to carry identical style
 * numbers, measurements and colours (the master prompt's own consistency
 * rule) and editing a field can rebuild every prompt instantly.
 *
 * Every row is user-editable in the UI. A fact carries one of three
 * statuses, mirroring the master prompt's own flags:
 *   CONFIRMED   — known from the ERP record or clearly visible
 *   ASSUMED     — inferred ("[ASSUMED — confirm with designer]")
 *   NOT_VISIBLE — cannot be determined ("[NOT VISIBLE — confirm with designer]")
 */
export const FACT_STATUSES = ["CONFIRMED", "ASSUMED", "NOT_VISIBLE"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

const status = z.enum(FACT_STATUSES).catch("ASSUMED");
const text = z.string().catch("");

const fieldSchema = z.object({ label: text, value: text, status });

export const masterAnalysisSchema = z.object({
  garmentVisualDescription: z.string().min(1),
  identification: z.array(fieldSchema),
  construction: z.array(fieldSchema),
  closure: z.array(fieldSchema),
  seamCallouts: z.array(
    z.object({ number: z.coerce.number().int().catch(0), location: text, specification: text, status: z.enum(["PROPOSED", "CONFIRMED"]).catch("PROPOSED") })
  ),
  colors: z.array(z.object({ name: text, pantone: text, hex: text, panel: text })),
  colorways: z.array(z.object({ code: text, name: text, main: text, contrast: text, trim: text, artwork: text, notes: text })),
  artwork: z.array(
    z.object({ type: text, placement: text, scale: text, dimensions: text, method: text, fromHps: text, fromCf: text, alignment: text })
  ),
  patternPrint: z.array(fieldSchema),
  bom: z.array(
    z.object({ item: text, description: text, composition: text, gsm: text, color: text, consumption: text, supplier: text, notes: text, status })
  ),
  sizes: z.array(z.string()).min(1),
  baseSize: z.string().min(1),
  measurements: z.array(
    z.object({
      code: text,
      pom: text,
      howToMeasure: text,
      tolerance: text,
      baseValue: z.coerce.number().catch(0),
      gradeRule: z.coerce.number().catch(0),
      status,
    })
  ),
  labelsPackaging: z.array(fieldSchema),
  notesForDesigner: z.array(z.string()),
  suggestedAdditionalViews: z.array(z.string()),
});

export type MasterAnalysis = z.infer<typeof masterAnalysisSchema>;
export type MasterField = z.infer<typeof fieldSchema>;

export function validateMasterAnalysis(input: unknown): { success: true; data: MasterAnalysis } | { success: false; error: string } {
  const result = masterAnalysisSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    return { success: false, error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid structured response." };
  }
  if (result.data.bom.length < 14) return { success: false, error: `bom: at least 14 rows are required (got ${result.data.bom.length}).` };
  if (result.data.measurements.length < 8) {
    return { success: false, error: `measurements: at least 8 points of measure are required (got ${result.data.measurements.length}).` };
  }
  return { success: true, data: result.data };
}

/**
 * Grading is computed here, never by the AI, so it is always mathematically
 * consistent: value(size) = baseValue + (sizeIndex − baseIndex) × gradeRule,
 * rounded to 0.5 cm.
 */
export function gradedValue(analysis: Pick<MasterAnalysis, "sizes" | "baseSize">, m: { baseValue: number; gradeRule: number }, size: string): number {
  const baseIdx = Math.max(0, analysis.sizes.indexOf(analysis.baseSize));
  const idx = analysis.sizes.indexOf(size);
  const raw = m.baseValue + (idx - baseIdx) * m.gradeRule;
  return Math.round(raw * 2) / 2;
}

/** Stored in AiDesignerTechPack.garmentAnalysisJson — the `format` tag distinguishes it from the older table-based (v4) shape. */
export interface MasterTechPackJson {
  format: "MASTER_V1";
  analysis: MasterAnalysis;
}

export function isMasterTechPackJson(value: unknown): value is MasterTechPackJson {
  return !!value && typeof value === "object" && (value as { format?: unknown }).format === "MASTER_V1";
}

/**
 * Hybrid tech pack (2026-09-28): pages that are mostly garment drawings are
 * AI page images; the three table-heavy pages (BOM, spec table, grading) are
 * TYPESET by the PDF renderer straight from the analysis, because image
 * models scramble dense tables (confirmed live: a 14-row BOM came back with
 * duplicated/shuffled rows even though the data was correct).
 */
export type MasterPageMode = "AI" | "TYPESET";

export const MASTER_PAGE_DEFINITIONS: readonly { pageNumber: number; title: string; mode: MasterPageMode }[] = [
  { pageNumber: 1, title: "COVER PAGE / STYLE SUMMARY", mode: "AI" },
  { pageNumber: 2, title: "CONSTRUCTION & DETAIL CALLOUTS", mode: "AI" },
  { pageNumber: 3, title: "BILL OF MATERIALS / BOM", mode: "TYPESET" },
  { pageNumber: 4, title: "COLORWAYS & ARTWORK PLACEMENT", mode: "AI" },
  { pageNumber: 5, title: "MEASUREMENTS & SPEC TABLE", mode: "TYPESET" },
  { pageNumber: 6, title: "SIZE GRADING", mode: "TYPESET" },
  { pageNumber: 7, title: "LABELS & PACKAGING", mode: "AI" },
];

export function pageMode(pageNumber: number): MasterPageMode {
  return MASTER_PAGE_DEFINITIONS.find((d) => d.pageNumber === pageNumber)?.mode ?? "AI";
}

export const AI_PAGE_NUMBERS = MASTER_PAGE_DEFINITIONS.filter((d) => d.mode === "AI").map((d) => d.pageNumber);

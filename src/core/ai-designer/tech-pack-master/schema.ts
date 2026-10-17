import { z } from "zod";

/**
 * AI Designer Tech Pack, "master prompt" flow (2026-09-28) — the structured
 * garment analysis (categories A–J of the company's own "GARMENT TECH PACK
 * SPEC SHEET GENERATOR" master prompt). The AI returns ONLY this analysis;
 * the page image prompts are then built from it in code
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
  // Colours / colorways / artwork / pattern fed only the Colorways & Artwork page, which was
  // removed (2026-10-17). New analyses no longer ask for them; older stored analyses still carry them.
  colors: z.array(z.object({ name: text, pantone: text, hex: text, panel: text })).default([]),
  colorways: z.array(z.object({ code: text, name: text, main: text, contrast: text, trim: text, artwork: text, notes: text })).default([]),
  artwork: z
    .array(z.object({ type: text, placement: text, scale: text, dimensions: text, method: text, fromHps: text, fromCf: text, alignment: text }))
    .default([]),
  patternPrint: z.array(fieldSchema).default([]),
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

/**
 * Every column the UI renders as an editable table cell must start with a
 * real AI-suggested value, never a blank the user has to notice and fill in
 * themselves — the prompt already asks for this (see NOT_VISIBLE guidance
 * above), but a model can and does still skip it on some rows/fields, so
 * this is enforced here too: an empty string on any of these columns is
 * treated as a validation failure, which triggers the existing one-shot
 * corrective retry (see requestStructuredVisionOutput) naming exactly which
 * fields came back blank. This never touches numeric columns (0 is a
 * legitimate real value, e.g. a POM that genuinely doesn't grade across
 * sizes) and never requires an array itself to be non-empty (e.g. a garment
 * with no artwork legitimately has zero artwork rows) — only that whatever
 * rows the model DID return have every text column filled in.
 */
function findBlankFields(a: MasterAnalysis): string[] {
  const issues: string[] = [];
  const checkFieldArray = (name: string, arr: { label: string; value: string }[]) => {
    arr.forEach((f, i) => {
      if (!f.value.trim()) issues.push(`${name}[${i}] ("${f.label}")`);
    });
  };
  checkFieldArray("identification", a.identification);
  checkFieldArray("construction", a.construction);
  checkFieldArray("closure", a.closure);
  checkFieldArray("labelsPackaging", a.labelsPackaging);

  a.seamCallouts.forEach((c, i) => {
    if (!c.location.trim()) issues.push(`seamCallouts[${i}].location`);
    if (!c.specification.trim()) issues.push(`seamCallouts[${i}].specification`);
  });
  a.bom.forEach((b, i) => {
    (["item", "description", "composition", "gsm", "color", "consumption", "supplier", "notes"] as const).forEach((k) => {
      if (!b[k].trim()) issues.push(`bom[${i}].${k}`);
    });
  });
  a.measurements.forEach((m, i) => {
    (["pom", "howToMeasure", "tolerance"] as const).forEach((k) => {
      if (!m[k].trim()) issues.push(`measurements[${i}].${k}`);
    });
  });

  return issues;
}

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
  const blanks = findBlankFields(result.data);
  if (blanks.length > 0) {
    const shown = blanks.slice(0, 20).join(", ");
    const more = blanks.length > 20 ? ` (+${blanks.length - 20} more)` : "";
    return {
      success: false,
      error: `These fields were left blank: ${shown}${more}. Every field must have a real, specific value — give your best professional default per the NOT_VISIBLE rule, never an empty string.`,
    };
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
 * Hybrid tech pack (2026-09-28, revised 2026-09-29): every page now gets a
 * real AI-generated image, matching the visual style the user asked for
 * across all 7 pages. Pages 1/2/4/7 (AI) are a full-page AI illustration.
 * Pages 3/5/6 (HYBRID — BOM, spec table, grading) are the table-heavy pages:
 * the AI still draws a real illustration for them (a materials board, a
 * measurement diagram, a grade-progression silhouette diagram), but its
 * prompt (see page-prompts.ts) deliberately asks for ONLY that illustration,
 * never the actual numbers/table — because image models scramble dense
 * tables (confirmed live: a 14-row BOM came back with duplicated/shuffled
 * rows even though the data was correct). The real table for a HYBRID page
 * is always typeset by the PDF renderer straight from the analysis and
 * composited below the AI illustration, so the illustration can never make a
 * number wrong.
 */
export type MasterPageMode = "AI" | "HYBRID";

export const MASTER_PAGE_DEFINITIONS: readonly { pageNumber: number; title: string; mode: MasterPageMode }[] = [
  { pageNumber: 1, title: "COVER PAGE / STYLE SUMMARY", mode: "AI" },
  { pageNumber: 2, title: "CONSTRUCTION & DETAIL CALLOUTS", mode: "AI" },
  { pageNumber: 3, title: "BILL OF MATERIALS / BOM", mode: "HYBRID" },
  // Removed 2026-10-17: page 4 (Colorways & Artwork) and page 5 (Measurements & Spec Table — its
  // base-size values repeat the Size Grading table, which now also carries tolerance and
  // how-to-measure). Page numbers are stored per row, so the remaining pages keep their numbers
  // and older tech packs that still have those pages render unchanged.
  { pageNumber: 6, title: "SIZE GRADING", mode: "HYBRID" },
  { pageNumber: 7, title: "LABELS & PACKAGING", mode: "AI" },
];

/** Pages no longer generated, kept so older tech packs that have them still render the same way. */
const REMOVED_PAGE_MODES: Record<number, MasterPageMode> = { 4: "AI", 5: "HYBRID" };

export function pageMode(pageNumber: number): MasterPageMode {
  return MASTER_PAGE_DEFINITIONS.find((d) => d.pageNumber === pageNumber)?.mode ?? REMOVED_PAGE_MODES[pageNumber] ?? "AI";
}

export const AI_PAGE_NUMBERS = MASTER_PAGE_DEFINITIONS.filter((d) => d.mode === "AI").map((d) => d.pageNumber);

/**
 * The page number a reader sees ("PAGE 4 of 6"): the page's position among
 * the pages a tech pack actually has, not its stored pageNumber. Pass the
 * pack's own stored page numbers; defaults to the current definitions.
 */
export function displayPageNumber(pageNumber: number, pageNumbers: readonly number[] = MASTER_PAGE_DEFINITIONS.map((d) => d.pageNumber)): number {
  const sorted = [...pageNumbers].sort((a, b) => a - b);
  const index = sorted.indexOf(pageNumber);
  return index >= 0 ? index + 1 : pageNumber;
}

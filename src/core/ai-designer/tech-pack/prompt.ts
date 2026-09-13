import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { STANDARD_SIZES } from "./schema";

export const GRADING_PROMPT_VERSION = "ai-designer-tech-pack-grading-v1";
export const BOM_PROMPT_VERSION = "ai-designer-tech-pack-bom-v1";

export interface TechPackDesignContext {
  productCategory: string;
  designSelections: string;
  fabricDescription: string;
  targetCustomer: string;
  ageGroup: string;
}

function buildContextLines(ctx: TechPackDesignContext): string[] {
  return [
    `Garment Category: ${ctx.productCategory}`,
    `Design Details: ${ctx.designSelections}`,
    `Fabric: ${ctx.fabricDescription}`,
    `Target Customer: ${ctx.targetCustomer}`,
    `Age Group: ${ctx.ageGroup}`,
  ];
}

// ---------------------------------------------------------------------------
// Grading (graded Point-of-Measure chart)
// ---------------------------------------------------------------------------

/**
 * Written fresh for this feature (no verbatim spec existed) — scoped from
 * the reference product's own "calculating graded measurements" phrasing.
 * Deliberately grades across a small fixed size set (STANDARD_SIZES), not
 * this company's real Size master — see schema.ts's own comment on that
 * scope choice.
 */
export function buildGradingSystemPrompt(): string {
  return `Act as a senior technical designer/pattern-maker drafting a first-pass graded Point-of-Measure (POM) chart for a new garment, before real technical measurement and grading review.

Propose 8-15 measurement points genuinely relevant to this specific garment's own category, silhouette, and construction (never a point that makes no sense for the garment type — e.g. no "inseam" for a top). For each point, give: a clear point name, a brief how-to-measure instruction, a sensible tolerance in cm, and a graded value for every one of these sizes: ${STANDARD_SIZES.join(", ")} — graded sensibly from a reasonable base size (M).

State plainly, in your own general notes, that this is a reasonable starting draft only, pending real technical measurement and grading review by a pattern-maker — never present these as confirmed final production measurements.`;
}

export function buildGradingUserText(ctx: TechPackDesignContext): string {
  return buildContextLines(ctx).join("\n");
}

function stringField() {
  return { type: "string" };
}

export function buildGradingToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pointName: stringField(),
            howToMeasure: stringField(),
            toleranceCm: stringField(),
            values: {
              type: "object",
              properties: Object.fromEntries(STANDARD_SIZES.map((s) => [s, stringField()])),
              required: [...STANDARD_SIZES],
            },
          },
          required: ["pointName", "howToMeasure", "toleranceCm", "values"],
        },
      },
      generalNotes: stringField(),
    },
    required: ["points", "generalNotes"],
  };
}

// ---------------------------------------------------------------------------
// BOM (draft Bill of Materials)
// ---------------------------------------------------------------------------

/**
 * Own, isolated BOM-suggestion prompt — deliberately a simpler shape than
 * AI Garment Flow's own richer BOM Suggestion process (no colour-shade note,
 * no wastage percentage, no resolve-into-a-real-BomItem step at all, since
 * AI Designer has no Style-graduation/BOM-mrp integration of its own).
 * Duplicated intent, not shared code, per this module's established
 * isolation from AI Garment Flow.
 */
export function buildBomSystemPrompt(): string {
  return `Act as a senior garment merchandiser drafting a first-pass Bill of Materials (BOM) for a new style, before real costing and sourcing.

Based on the garment design and fabric described, suggest a realistic draft BOM for ONE finished garment piece — the main fabric, and every trim/accessory/packaging item this specific design actually calls for (e.g. sewing thread, buttons, zippers, elastic, labels, hang tags, poly bags) — scaled to what the design actually needs, never padding the list with an item the design gives no reason to need.

For each line, give: a clear material description, its category, a realistic estimated consumption quantity for one garment with your own best-estimate unit of measure, and a short reasoning.

Never invent an exact cost. State clearly in your reasoning that every quantity is a commercial estimate pending real technical measurement.`;
}

export function buildBomUserText(ctx: TechPackDesignContext): string {
  return buildContextLines(ctx).join("\n");
}

export function buildBomToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            materialDescription: stringField(),
            materialCategory: { type: "string", enum: [...MATERIAL_CATEGORIES] },
            suggestedQuantityPerUnit: { type: "number" },
            suggestedUom: stringField(),
            reasoning: stringField(),
          },
          required: ["materialDescription", "materialCategory", "suggestedQuantityPerUnit", "suggestedUom", "reasoning"],
        },
      },
    },
    required: ["items"],
  };
}

// ---------------------------------------------------------------------------
// Flat sketch (image generation, ImageGenerationProvider.generateTechnicalFlat)
// ---------------------------------------------------------------------------

export const FLAT_SKETCH_PROMPT_VERSION = "ai-designer-tech-pack-flat-sketch-v1";

/**
 * Same "clean two-view, black line-art, no real fabric colour/texture"
 * discipline as AI Garment Flow's own Technical Development process — this
 * is a generic property of what a technical flat sketch conventionally
 * looks like, not business logic borrowed from that module. Written fresh
 * for AI Designer, not imported.
 */
export function buildFlatSketchPrompt(): string {
  return `Regenerate this garment as a clean, professional technical flat sketch (CAD-style line drawing) suitable for a factory tech pack — front view and back view side by side on a plain white background.

Use simple black line art only — do not render the real fabric's colour, print, or texture; a flat sketch conventionally shows construction and silhouette only, regardless of the garment's actual fabric.

Preserve every existing construction detail exactly as designed (neckline, sleeve, closures, pockets, seams, hems) — do not redesign or simplify the garment.

The output must be a clean, dimensionally plausible technical drawing, not a photorealistic image and not fashion illustration art.`;
}

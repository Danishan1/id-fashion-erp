import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";

export const PROMPT_VERSION = "bom-suggestion-v1";

/**
 * The hidden AI prompt. Never sent to the browser — only used server-side
 * inside requestStructuredTextOutput(). Written for this process since no
 * verbatim business-prompt spec was given for it (unlike Processes 1-6) —
 * scoped from the existing `generateDraftBOM(input: { productId })`
 * placeholder and the real Bom/BomItem schema this feeds into.
 */
export const BOM_SUGGESTION_SYSTEM_PROMPT = `Act as a senior garment merchandiser and production planner responsible for authoring a first-draft Bill of Materials (BOM) for a new style, before real costing and sourcing begins.

Based on the approved garment design and any known fabric information, suggest a realistic draft BOM for ONE finished garment piece — the main fabric(s), lining if applicable, and every trim, accessory, and packaging item a garment of this type would realistically need (for example: sewing thread, interlining/fusing, buttons, zippers, elastic, drawcords, care/brand labels, hang tags, poly bags), scaled to what this specific design actually calls for. Do not suggest an item the design gives no reason to need.

For each line, state:
- A clear material description
- Its category
- A realistic estimated consumption quantity for one garment, with your own best-estimate unit of measure
- A realistic wastage percentage
- An optional colour/shade note
- A short reasoning for why this line is needed and how you estimated its quantity

Never invent an exact cost. Never state a consumption figure as if it were derived from a real pattern or marker — make clear in your reasoning that every quantity is a commercial estimate pending real technical measurement.`;

function buildToolContractAddendum(): string {
  return `
You must respond by calling the provided tool exactly once, with between 1 and 20 items in the "items" array — one per suggested BOM line. "materialCategory" must be exactly one of: ${MATERIAL_CATEGORIES.join(", ")}. "suggestedUom" is a short free-text unit (e.g. "MTR", "PCS", "SET", "KG") describing what the quantity is measured in — you do not know this company's real unit-of-measure records, so describe it in plain words; a human will map it to a real unit when reviewing your suggestion. Do not repeat the same material twice for the same purpose in two separate lines.`;
}

export function buildSystemPrompt(): string {
  return `${BOM_SUGGESTION_SYSTEM_PROMPT}\n${buildToolContractAddendum()}`;
}

export interface BomSuggestionContext {
  designDirectionName: string;
  silhouette: string;
  garmentLength: string;
  fit: string;
  neckline: string;
  collar: string;
  sleeve: string;
  closure: string;
  pocket: string;
  waistTreatment: string;
  hem: string;
  keyNewDesignFeature: string;
  suggestedFabricCharacter: string;
  suggestedTrims: string;
  /** Only included when AiGarmentFabricDetail already exists for this project. */
  fabricDescription?: string | null;
  targetMarket?: string | null;
  season?: string | null;
  /** Free-text runtime input, never persisted anywhere except the run's own audit log — same non-persisted-override convention already used by Development Brief's factoryCapabilities and Process 7's additionalNotes. */
  additionalGuidance?: string | null;
}

export function buildUserText(ctx: BomSuggestionContext): string {
  const lines: string[] = [
    `=== Approved Garment Design: ${ctx.designDirectionName} ===`,
    `Silhouette: ${ctx.silhouette}`,
    `Garment Length: ${ctx.garmentLength}`,
    `Fit: ${ctx.fit}`,
    `Neckline: ${ctx.neckline}`,
    `Collar: ${ctx.collar}`,
    `Sleeve: ${ctx.sleeve}`,
    `Closure: ${ctx.closure}`,
    `Pocket: ${ctx.pocket}`,
    `Waist Treatment: ${ctx.waistTreatment}`,
    `Hem: ${ctx.hem}`,
    `Key New Design Feature: ${ctx.keyNewDesignFeature}`,
    `Suggested Fabric Character (from Development Brief): ${ctx.suggestedFabricCharacter}`,
    `Suggested Trims (from Development Brief): ${ctx.suggestedTrims}`,
  ];
  if (ctx.fabricDescription) lines.push(`Fabric (if known): ${ctx.fabricDescription}`);
  if (ctx.targetMarket) lines.push(`Market: ${ctx.targetMarket}`);
  if (ctx.season) lines.push(`Season: ${ctx.season}`);
  if (ctx.additionalGuidance) lines.push("", `Additional guidance from the merchandiser: ${ctx.additionalGuidance}`);
  return lines.join("\n");
}

function stringField() {
  return { type: "string" };
}

function bomSuggestionItemNode() {
  return {
    type: "object",
    properties: {
      materialDescription: stringField(),
      materialCategory: { type: "string", enum: [...MATERIAL_CATEGORIES] },
      // `exclusiveMinimum` is rejected outright by Anthropic's tool-schema
      // validator for a "number" property (confirmed live: "For 'number'
      // type, property 'exclusiveMinimum' is not supported") — positivity is
      // enforced by the Zod schema instead, the same "the tool schema states
      // shape, the Zod layer states the real constraints" split already used
      // by Process 2/5's own array-length handling.
      suggestedQuantityPerUnit: { type: "number" },
      suggestedUom: stringField(),
      suggestedWastagePercentage: { type: "number", minimum: 0, maximum: 100 },
      colorNote: stringField(),
      reasoning: stringField(),
    },
    required: [
      "materialDescription",
      "materialCategory",
      "suggestedQuantityPerUnit",
      "suggestedUom",
      "suggestedWastagePercentage",
      "reasoning",
    ],
  };
}

/** `min`/`max` item-count bounds are enforced by validateBomSuggestionResponse's own Zod check, not the tool schema itself — Anthropic's `strict: true` tool mode rejects `minItems`/`maxItems` on an array node, the same confirmed-live limitation Process 2/5's own array schemas already documented. */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      items: { type: "array", items: bomSuggestionItemNode() },
    },
    required: ["items"],
  };
}

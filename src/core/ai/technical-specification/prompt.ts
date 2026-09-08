export const PROMPT_VERSION = "technical-specification-v1";

/**
 * The hidden AI prompt. Never sent to the browser — only used server-side
 * inside requestStructuredTextOutput(). Written fresh (no verbatim brief
 * exists for this process, same as Processes 7-11's own predecessor
 * entries), scoped per the user's own explicit choice (via AskUserQuestion)
 * to a Point-of-Measure chart specifically, over construction/stitch notes
 * or trim/packaging notes.
 */
export const TECHNICAL_SPECIFICATION_SYSTEM_PROMPT = `Act as a senior technical designer and patternmaker for a garment manufacturer.

Given a garment design's own structured construction details, draft a Point-of-Measure (POM) chart — the
standard measurement specification a factory pattern room needs to grade and cut this style.

Propose measurement points genuinely relevant to THIS garment's own silhouette, fit, and construction — do
not propose a measurement point that makes no sense for this garment type (e.g. no "inseam" for a top with
no legs). For each point, give a brief instruction on how to measure it (e.g. "Measured flat, 1 inch below
the armhole, side seam to side seam"), a reasonable tolerance (e.g. "+/- 1 cm"), and a numeric value with
unit for every size listed, graded sensibly between sizes.

These are a reasonable STARTING DRAFT only, pending real technical measurement and grading review by a
pattern-maker before any pattern is cut — never present these as confirmed, final production measurements.
Do not claim to follow a specific national body-measurement standard unless one is explicitly stated below —
grade from a sensible base size using standard, conservative per-size increments appropriate to this garment
category.

Also provide a short general notes paragraph stating the grading assumption used and reminding the reader
this chart must be verified against the company's own grade rules before cutting.`;

/**
 * Technical addendum — the exact tool-call contract, matching every other
 * process's own "state the array-length constraint in the prompt text, not
 * the tool schema" discipline (see buildToolInputSchema below).
 */
function buildToolContractAddendum(sizeCount: number, sizeNames: string[]): string {
  return `
You must respond by calling the provided tool exactly once. The "measurementPoints" array should contain
between 8 and 15 points appropriate to this garment. Each point's own "values" array must contain exactly
${sizeCount} entries, one per size, in this exact order (do not omit or reorder any): ${sizeNames.join(", ")}.`;
}

export function buildSystemPrompt(sizeCount: number, sizeNames: string[]): string {
  return `${TECHNICAL_SPECIFICATION_SYSTEM_PROMPT}\n${buildToolContractAddendum(sizeCount, sizeNames)}`;
}

export interface SizeForSpec {
  /** 1-based position in the array actually sent to the model — never the real database id. */
  displayNumber: number;
  name: string;
}

export interface TechnicalSpecificationContext {
  designDirectionName: string;
  silhouette: string;
  garmentLength: string;
  fit: string;
  neckline: string;
  collar: string;
  sleeve: string;
  shoulderConstruction: string;
  frontConstruction: string;
  backConstruction: string;
  closure: string;
  pocket: string;
  waistTreatment: string;
  hem: string;
  /** Only included when AiGarmentFabricDetail already exists for this project. */
  fabricDescription?: string | null;
  additionalNotes?: string | null;
  sizes: SizeForSpec[];
}

export function buildUserText(ctx: TechnicalSpecificationContext): string {
  const lines: string[] = [
    "=== Design to Specify ===",
    `Design: ${ctx.designDirectionName}`,
    `Silhouette: ${ctx.silhouette}`,
    `Garment Length: ${ctx.garmentLength}`,
    `Fit: ${ctx.fit}`,
    `Neckline: ${ctx.neckline}`,
    `Collar: ${ctx.collar}`,
    `Sleeve: ${ctx.sleeve}`,
    `Shoulder Construction: ${ctx.shoulderConstruction}`,
    `Front Construction: ${ctx.frontConstruction}`,
    `Back Construction: ${ctx.backConstruction}`,
    `Closure: ${ctx.closure}`,
    `Pocket: ${ctx.pocket}`,
    `Waist Treatment: ${ctx.waistTreatment}`,
    `Hem: ${ctx.hem}`,
  ];
  if (ctx.fabricDescription) lines.push(`Fabric (if known): ${ctx.fabricDescription}`);
  if (ctx.additionalNotes) lines.push(`Additional guidance from the user: ${ctx.additionalNotes}`);

  lines.push("", `=== ${ctx.sizes.length} Sizes to Grade (in this exact order) ===`);
  for (const s of ctx.sizes) lines.push(`SIZE ${s.displayNumber}: ${s.name}`);

  return lines.join("\n");
}

function measurementPointNode() {
  return {
    type: "object",
    properties: {
      measurementName: { type: "string" },
      howToMeasure: { type: "string" },
      toleranceText: { type: "string" },
      values: { type: "array", items: { type: "string" } },
    },
    required: ["measurementName", "howToMeasure", "toleranceText", "values"],
  };
}

/**
 * Array-length constraints (both the outer measurementPoints array and each
 * point's own per-size values array) are stated in the prompt text and
 * enforced by validateTechnicalSpecificationResponse's own exact-length
 * check, never in this tool schema — Anthropic's `strict: true` tool mode
 * rejects `minItems`/`maxItems` on an array node outright, confirmed live
 * already for Process 5's own comparably-shaped array-of-objects schema.
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      generalNotes: { type: "string" },
      measurementPoints: { type: "array", items: measurementPointNode() },
    },
    required: ["generalNotes", "measurementPoints"],
  };
}

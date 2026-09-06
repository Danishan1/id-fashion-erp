import { CONFIDENCE_VALUES, COMPLEXITY_VALUES } from "./schema";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output shape/meaning — stored on every AiGarmentReferenceAnalysis /
 * AiGarmentReferenceAnalysisRun row so a past analysis stays auditable
 * against the exact prompt that produced it, even after this text changes.
 */
export const PROMPT_VERSION = "reference-analysis-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — only used
 * server-side inside requestStructuredVisionOutput(). Verbatim per the
 * product brief; do not display this to end users.
 */
export const REFERENCE_ANALYSIS_SYSTEM_PROMPT = `You are an experienced apparel product developer, garment technologist, fashion designer and garment manufacturing consultant.

You are analysing a garment reference image for a professional garment product-development and manufacturing workflow.

The reference is being used for product-development research, commercial analysis and inspiration.

Do not encourage direct copying of distinctive, proprietary or clearly identifiable design elements.

The purpose is to understand:
- garment structure
- design language
- silhouette
- visible fabric behaviour
- construction characteristics
- commercial characteristics
- likely manufacturing implications

so that differentiated garments can later be developed.

Analyse ONLY what can reasonably be determined from the supplied image.

Never present uncertain visual assumptions as confirmed technical facts.

For every relevant observation assign exactly one confidence classification:
- CONFIRMED VISUALLY
- LIKELY / INFERRED
- NOT DETERMINABLE

If an item cannot be seen or reliably inferred, explicitly mark it as:
NOT DETERMINABLE

Do not invent unseen back details, internal construction, fabric composition or measurements.

Analyse the following:

1. GARMENT CATEGORY
2. SILHOUETTE
3. GARMENT LENGTH
4. FIT
5. NECKLINE
6. COLLAR
7. SLEEVE

Analyse:
- type
- length
- volume
- cuff / sleeve finish

8. SHOULDER CONSTRUCTION
9. FRONT CONSTRUCTION
10. BACK CONSTRUCTION

If the back is not visible, explicitly state that it is not determinable from the supplied image.

11. OPENING / CLOSURE
12. PANELS
13. SEAMS
14. DARTS
15. PLEATS
16. GATHERS
17. TUCKS
18. POCKETS
19. WAIST TREATMENT
20. HEM / BOTTOM FINISH
21. TRIMS
22. DECORATIVE DETAILS
23. VISIBLE FABRIC CHARACTERISTICS

Do NOT guess exact fibre composition.

Describe only visually observable or reasonably inferred characteristics such as:
- apparent weight
- drape
- texture
- apparent stretch behaviour
- transparency / opacity
- surface character
- sheen / matte appearance

Do not claim fibre content such as cotton, polyester, silk, viscose, wool, etc. unless supplied separately in project information.

24. PRINT / PATTERN

Analyse where applicable:
- pattern type
- scale
- direction
- placement
- repeat appearance
- engineered placement appearance

Do not claim an exact repeat measurement unless measurable information has been supplied.

25. CONSTRUCTION COMPLEXITY

Choose exactly one:
LOW
MEDIUM
HIGH

Then explain why.

Consider factors such as:
- number of visible components
- seam complexity
- shaping
- trims
- closures
- fabric handling difficulty
- pattern matching
- finishing
- likely sewing operations

26. LIKELY MANUFACTURING CHALLENGES

Identify practical garment-manufacturing considerations visible or reasonably inferred from the reference.

27. KEY DESIGN-LANGUAGE FEATURES

Identify the main visual/design characteristics that define the garment's overall aesthetic.

28. FEATURES SUITABLE FOR FURTHER DEVELOPMENT

Identify features that could act as general inspiration or development directions.

29. FEATURES THAT SHOULD BE CHANGED SUBSTANTIALLY TO CREATE A DIFFERENTIATED COMMERCIAL GARMENT

Identify areas where meaningful changes would help create a distinct product rather than directly reproducing the reference.

30. MISSING INFORMATION REQUIRED BEFORE TECHNICAL DEVELOPMENT

Identify what cannot be determined from the image and should later be provided or developed.

Examples may include:
- back view
- internal construction
- exact measurements
- fabric composition
- GSM
- stretch percentage
- trim specifications
- closure specifications
- stitching specifications
- fit measurements
- finishing details

Only mention relevant missing information.

Finally create:
DESIGN DNA SUMMARY
Maximum 150 words.

The summary should capture the overall design language, silhouette, visual character, commercial impression and construction direction.

Do NOT design new garments.
Do NOT create colourways.
Do NOT create sketches.
Do NOT generate technical specifications that cannot be justified from the image.
Do NOT create BOM.
Do NOT calculate costing.
Do NOT move into Development Brief.

Return ONLY data matching the required structured JSON schema.`;

/**
 * Technical addendum (not part of the hidden business prompt above, and
 * never shown to end users either) explaining the exact tool-call contract
 * and the machine-readable enum tokens the tool schema constrains output
 * to — the business prompt's own "CONFIRMED VISUALLY / LIKELY / INFERRED /
 * NOT DETERMINABLE" wording stays human-readable; this just maps it to the
 * literal strings the tool's input_schema enforces.
 */
const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every "confidence" field must be exactly one of: CONFIRMED_VISUALLY, LIKELY_INFERRED, NOT_DETERMINABLE. The "constructionComplexityLevel" field must be exactly one of: LOW, MEDIUM, HIGH. Every field in the schema is required — for a field you cannot determine, still provide an observation object with confidence NOT_DETERMINABLE and a brief note explaining why, rather than omitting the field.`;

export function buildSystemPrompt(): string {
  return `${REFERENCE_ANALYSIS_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

/**
 * Only the non-sensitive project fields relevant to interpreting the image
 * (garment category hint, target market/customer) are ever included — never
 * pricing, buyer identity, or any other company/commercial information not
 * needed for visual analysis, per explicit instruction.
 */
export function buildUserText(projectContext: { garmentCategory?: string | null; targetMarket?: string | null }): string {
  const lines = ["Analyse the attached reference garment image."];
  if (projectContext.garmentCategory) {
    lines.push(`Known garment category context (if helpful, do not let this override what the image actually shows): ${projectContext.garmentCategory}.`);
  }
  if (projectContext.targetMarket) {
    lines.push(`Target market context: ${projectContext.targetMarket}.`);
  }
  return lines.join("\n");
}

function observationNode() {
  return {
    type: "object",
    properties: {
      observation: { type: "string" },
      confidence: { type: "string", enum: [...CONFIDENCE_VALUES] },
      manufacturingRelevance: { type: "string" },
    },
    required: ["observation", "confidence", "manufacturingRelevance"],
  };
}

const SIMPLE_OBSERVATION_KEYS = [
  "garmentCategory",
  "silhouette",
  "garmentLength",
  "fit",
  "neckline",
  "collar",
  "shoulderConstruction",
  "frontConstruction",
  "backConstruction",
  "openingClosure",
  "panels",
  "seams",
  "darts",
  "pleats",
  "gathers",
  "tucks",
  "pockets",
  "waistTreatment",
  "hem",
  "trims",
  "decorativeDetails",
] as const;

const GROUPED_OBSERVATION_KEYS = [
  "sleeveType",
  "sleeveLength",
  "sleeveVolume",
  "sleeveCuff",
  "fabricWeight",
  "fabricDrape",
  "fabricTexture",
  "fabricStretchAppearance",
  "fabricTransparency",
  "fabricSurfaceCharacter",
  "printPatternType",
  "printPatternScale",
  "printPatternDirection",
  "printPatternPlacement",
  "printPatternRepeatAppearance",
] as const;

/**
 * Built once from CONFIDENCE_VALUES/COMPLEXITY_VALUES + the shared key
 * lists — cannot drift from schema.ts's Zod shape since both read from the
 * same constants. Deliberately flat (no sleeve/fabricObservations/
 * printPattern/constructionComplexity sub-objects) — confirmed live against
 * the real API that the original nested shape made this schema too large
 * for Anthropic's `strict: true` grammar compiler ("The compiled grammar is
 * too large... Simplify your tool schemas"); flattening removes the nesting
 * that was driving that size, so `strict: true` (a real server-side
 * schema-shape guarantee) can stay on rather than being disabled — see
 * schema.ts's own comment for the full story, including why disabling
 * strict mode instead was tried first and made things worse.
 */
export function buildToolInputSchema() {
  const properties: Record<string, unknown> = {};
  for (const key of SIMPLE_OBSERVATION_KEYS) properties[key] = observationNode();
  for (const key of GROUPED_OBSERVATION_KEYS) properties[key] = observationNode();

  properties.constructionComplexityLevel = { type: "string", enum: [...COMPLEXITY_VALUES] };
  properties.constructionComplexityExplanation = { type: "string" };
  properties.manufacturingChallenges = { type: "array", items: { type: "string" } };
  properties.keyDesignLanguageFeatures = { type: "array", items: { type: "string" } };
  properties.featuresForFurtherDevelopment = { type: "array", items: { type: "string" } };
  properties.featuresToChangeForDifferentiation = { type: "array", items: { type: "string" } };
  properties.missingInformation = { type: "array", items: { type: "string" } };
  properties.designDnaSummary = { type: "string" };

  const required = [
    ...SIMPLE_OBSERVATION_KEYS,
    ...GROUPED_OBSERVATION_KEYS,
    "constructionComplexityLevel",
    "constructionComplexityExplanation",
    "manufacturingChallenges",
    "keyDesignLanguageFeatures",
    "featuresForFurtherDevelopment",
    "featuresToChangeForDifferentiation",
    "missingInformation",
    "designDnaSummary",
  ];

  return { type: "object" as const, properties, required };
}

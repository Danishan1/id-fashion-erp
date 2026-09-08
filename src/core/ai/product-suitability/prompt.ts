import { SUITABILITY_RATING_VALUES } from "./schema";

export const PROMPT_VERSION = "product-suitability-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — only used
 * server-side inside requestStructuredTextOutput(). Written fresh for this
 * process (no verbatim brief exists — only the process name and the dead
 * AIService placeholder's own inline copy, "AI would assess which garment
 * types suit this fabric here once connected," were given), matching the
 * discipline already established by Fabric/Reference Analysis's own prompts:
 * grounded only in already-established facts, never inventing new ones,
 * never overreaching into a later process's own job.
 */
export const PRODUCT_SUITABILITY_SYSTEM_PROMPT = `You are an experienced merchandiser and garment product developer.

You are assessing which types of finished garments a specific fabric is commercially and technically well suited for, using ONLY the fabric's own already-analysed characteristics below as evidence — not any specific garment design already in mind, and not fresh assumptions about the fabric beyond what has already been established.

You will be given a fixed list of garment types (drawn from this company's own real product-type catalogue) and must assess EVERY one of them — never skip one, never add one that wasn't given to you.

For each garment type, decide a suitability rating:
- HIGHLY_SUITABLE — the fabric's own analysed traits (weight, stretch, drape, structure, surface) are a strong, natural match for how this garment type is typically constructed and worn.
- SUITABLE — a reasonable, workable match, though not the fabric's most obvious use case.
- MARGINALLY_SUITABLE — technically possible but a compromise; name the specific tension between the fabric's traits and this garment type's typical needs.
- NOT_SUITABLE — a genuine mismatch (e.g. a fluid, sheer, non-recovering fabric proposed for a structured, tailored, close-fitted garment).

For every rating, give concrete reasoning that names the specific fabric traits driving the decision (e.g. "the fabric's high stretch and soft drape suit a fitted T-shirt or legging, but its lack of structure and see-through weight make it unsuitable for a tailored jacket that needs to hold its own shape"). Never give a generic, trait-free justification.

Do NOT suggest a specific silhouette, neckline, sleeve, or any other concrete design detail for any garment type — that decision belongs to a separate, later step, not this one.
Do NOT invent new fabric characteristics beyond what has already been established below.
Do NOT design a garment, create a Bill of Materials, or calculate costing.

Finally, write an OVERALL SUMMARY of maximum 100 words describing, in general commercial terms, what kind of product direction this fabric is best suited for overall (e.g. "casual knitwear for everyday wear" or "structured outerwear for cooler seasons") — without naming a specific silhouette or design.

Return ONLY data matching the required structured JSON schema.`;

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every "rating" field must be exactly one of: ${SUITABILITY_RATING_VALUES.join(", ")}. You must return exactly one item per garment type listed, in the exact same order they were given.`;

export function buildSystemPrompt(): string {
  return `${PRODUCT_SUITABILITY_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

export interface FabricObservationForPrompt {
  label: string;
  value: string;
}

export interface ProductTypeForSuitability {
  displayNumber: number;
  code: string;
  name: string;
}

export interface ProductSuitabilityContext {
  buyer?: string | null;
  customer?: string | null;
  targetMarket?: string | null;
  season?: string | null;
  targetSellingPrice?: number | null;
  currencyCode?: string | null;
  fabricSummary: string;
  fabricObservations: FabricObservationForPrompt[];
  /** Only included when AiGarmentFabricDetail already exists for this project — same "Fabric if known" convention Process 5/8/9 already use. */
  fabricDescription?: string | null;
  productTypes: ProductTypeForSuitability[];
}

export function buildUserText(ctx: ProductSuitabilityContext): string {
  const lines: string[] = ["=== Commercial Information (auto-pulled from the project) ==="];
  if (ctx.buyer) lines.push(`Buyer: ${ctx.buyer}`);
  if (ctx.customer) lines.push(`Customer: ${ctx.customer}`);
  if (ctx.targetMarket) lines.push(`Market: ${ctx.targetMarket}`);
  if (ctx.season) lines.push(`Season: ${ctx.season}`);
  if (ctx.targetSellingPrice != null) lines.push(`Target Price: ${ctx.targetSellingPrice} ${ctx.currencyCode ?? ""}`.trim());
  if (ctx.fabricDescription) lines.push(`Fabric Master Detail (if known): ${ctx.fabricDescription}`);
  if (lines.length === 1) lines.push("(No commercial context has been recorded on this project yet.)");

  lines.push("", "=== Approved Fabric Analysis ===", ctx.fabricSummary, "");
  for (const obs of ctx.fabricObservations) {
    lines.push(`${obs.label}: ${obs.value}`);
  }

  lines.push("", `=== ${ctx.productTypes.length} Garment Types to Assess ===`);
  for (const pt of ctx.productTypes) {
    lines.push(`GARMENT TYPE ${pt.displayNumber}: ${pt.name} (${pt.code})`);
  }

  return lines.join("\n");
}

function ratingItemNode() {
  return {
    type: "object",
    properties: {
      rating: { type: "string", enum: [...SUITABILITY_RATING_VALUES] },
      reasoning: { type: "string" },
    },
    required: ["rating", "reasoning"],
  };
}

/**
 * Array length is not reliably enforceable via the tool schema alone
 * (Process 5's own prompt.ts documents Anthropic silently stripping
 * array-length keywords under strict:true) — the real enforcement is
 * schema.ts's own `.length(productTypeCount)` Zod check, backed by the
 * corrective-retry mechanism already built into requestStructuredToolCall().
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      items: { type: "array", items: ratingItemNode() },
      overallSummary: { type: "string" },
    },
    required: ["items", "overallSummary"],
  };
}

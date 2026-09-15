import { COMPATIBILITY_RATING_VALUES } from "./schema";

export const PROMPT_VERSION = "replicate-design-compatibility-check-v1";

/**
 * The hidden business/system prompt. Never sent to the browser. Per the
 * feature's own spec: this is advisory only, must never suggest changing the
 * garment's locked design, and must give the user real options (continue
 * anyway / use a suggested material / change fabric) rather than blocking.
 */
export const COMPATIBILITY_CHECK_SYSTEM_PROMPT = `You are an experienced garment technologist reviewing whether a company's chosen fabric and raw materials are technically and commercially appropriate for recreating an already-locked reference garment design.

You will be given the reference garment's own locked Design DNA (its structural design — silhouette, construction, etc., which must NOT be changed) and a list of fabric/material subjects the company has chosen to use instead of the garment's original materials.

For each subject, decide a compatibility rating:
- COMPATIBLE — a genuine, appropriate match for this garment's locked design.
- MINOR_CONCERN — workable, but name a specific, real tension (e.g. a lighter-than-ideal interlining for a structured collar).
- INCOMPATIBLE — a genuine mismatch that would prevent the garment's locked design from being properly recreated (e.g. a soft, drapey fabric proposed for a garment whose design requires a stiff, structured silhouette).

Give concrete reasoning naming the specific characteristics driving each rating. Never give a generic, trait-free justification.

Do NOT suggest changing the reference garment's own locked design in any way — the design is fixed; only the material choice is ever in question here.

Finally give an OVERALL SUMMARY (maximum 80 words) and one OVERALL RATING summarising the whole material selection together.

Return ONLY data matching the required structured JSON schema.`;

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every "rating"/"overallRating" field must be exactly one of: ${COMPATIBILITY_RATING_VALUES.join(", ")}. You must return exactly one item per subject listed, in the exact same order they were given.`;

export function buildSystemPrompt(): string {
  return `${COMPATIBILITY_CHECK_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

export interface CompatibilitySubjectForPrompt {
  displayNumber: number;
  label: string;
  detail: string;
}

export interface CompatibilityCheckContext {
  designDnaSummary: string;
  lockedObservations: { label: string; value: string }[];
  subjects: CompatibilitySubjectForPrompt[];
}

export function buildUserText(ctx: CompatibilityCheckContext): string {
  const lines: string[] = ["=== Locked Reference Garment Design DNA ===", ctx.designDnaSummary, ""];
  for (const obs of ctx.lockedObservations) {
    lines.push(`${obs.label}: ${obs.value}`);
  }

  lines.push("", `=== ${ctx.subjects.length} Fabric/Material Subjects to Assess ===`);
  for (const s of ctx.subjects) {
    lines.push(`SUBJECT ${s.displayNumber}: ${s.label} — ${s.detail}`);
  }

  return lines.join("\n");
}

function ratingItemNode() {
  return {
    type: "object",
    properties: {
      rating: { type: "string", enum: [...COMPATIBILITY_RATING_VALUES] },
      reasoning: { type: "string" },
    },
    required: ["rating", "reasoning"],
  };
}

/**
 * Array length is not reliably enforceable via the tool schema alone
 * (confirmed elsewhere in this codebase that Anthropic silently strips
 * array-length keywords under strict:true) — the real enforcement is
 * schema.ts's own `.length(subjectCount)` Zod check, backed by the
 * corrective-retry mechanism already built into requestStructuredToolCall().
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      items: { type: "array", items: ratingItemNode() },
      overallSummary: { type: "string" },
      overallRating: { type: "string", enum: [...COMPATIBILITY_RATING_VALUES] },
    },
    required: ["items", "overallSummary", "overallRating"],
  };
}

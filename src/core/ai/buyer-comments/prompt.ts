import { BUYER_COMMENT_CATEGORY_VALUES } from "./schema";

export const PROMPT_VERSION = "buyer-comments-v1";

/**
 * The hidden AI prompt. Never sent to the browser — only used server-side
 * inside requestStructuredTextOutput(). Written fresh (no verbatim brief
 * exists for this process), scoped per the user's own explicit choice (via
 * AskUserQuestion) to a read-only summary over Sampling's own real buyer
 * feedback, never a separate comment log.
 */
export const BUYER_COMMENTS_SYSTEM_PROMPT = `Act as a senior merchandiser summarising real buyer feedback for the rest of the product-development team.

You will be given the real comment thread and decision notes already recorded on this style's sample
request. Read them carefully and produce a structured, categorized summary of what the buyer is actually
asking to change.

Categorize each distinct point of feedback into exactly one of these categories: Fit, Construction, Fabric,
Color, Trim, Pricing, Other. Only include a category if the real feedback genuinely touches on it — do not
invent a category with nothing behind it, and do not pad the list to cover every category.

For each category you include, write a short, clear summary of what the buyer is asking for, and quote or
closely paraphrase the actual comment(s)/decision note(s) that support it, so a reader can trace the summary
straight back to the real feedback. Never invent feedback that wasn't actually given, and never present your
own interpretation as if it were a direct quote.

Also provide a short overall summary of the buyer's general sentiment and the single most important thing
the team should act on.`;

function buildToolContractAddendum(): string {
  return `
You must respond by calling the provided tool exactly once. The "categories" array may contain between 0 and
7 entries, one per genuinely distinct topic actually raised — valid category values are exactly:
${BUYER_COMMENT_CATEGORY_VALUES.join(", ")}.`;
}

export function buildSystemPrompt(): string {
  return `${BUYER_COMMENTS_SYSTEM_PROMPT}\n${buildToolContractAddendum()}`;
}

export interface RealCommentForPrompt {
  authorName: string;
  body: string;
  createdAt: string;
}

export interface RealDecisionForPrompt {
  decision: string;
  decisionNotes: string;
  decidedAt: string;
}

export interface BuyerCommentsContext {
  sampleRequestNumber: string;
  styleName: string | null;
  comments: RealCommentForPrompt[];
  decisions: RealDecisionForPrompt[];
}

export function buildUserText(ctx: BuyerCommentsContext): string {
  const lines: string[] = [
    `=== Sample Request ${ctx.sampleRequestNumber}${ctx.styleName ? ` — ${ctx.styleName}` : ""} ===`,
  ];

  if (ctx.comments.length > 0) {
    lines.push("", `--- ${ctx.comments.length} Comment(s) ---`);
    for (const c of ctx.comments) {
      lines.push(`[${c.createdAt}] ${c.authorName}: ${c.body}`);
    }
  }

  if (ctx.decisions.length > 0) {
    lines.push("", `--- ${ctx.decisions.length} Decision(s) with Notes ---`);
    for (const d of ctx.decisions) {
      lines.push(`[${d.decidedAt}] Decision: ${d.decision} — Notes: ${d.decisionNotes}`);
    }
  }

  return lines.join("\n");
}

function categorySummaryNode() {
  return {
    type: "object",
    properties: {
      category: { type: "string", enum: [...BUYER_COMMENT_CATEGORY_VALUES] },
      summary: { type: "string" },
      evidenceExcerpt: { type: "string" },
    },
    required: ["category", "summary", "evidenceExcerpt"],
  };
}

/**
 * The 0-7 category-count bound is stated in the prompt text and enforced by
 * validateBuyerCommentsResponse's own bounded-array check, never in this
 * tool schema — Anthropic's `strict: true` tool mode rejects
 * `minItems`/`maxItems` on an array node outright, confirmed live already
 * during Process 8's own build.
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      overallSummary: { type: "string" },
      categories: { type: "array", items: categorySummaryNode() },
    },
    required: ["overallSummary", "categories"],
  };
}

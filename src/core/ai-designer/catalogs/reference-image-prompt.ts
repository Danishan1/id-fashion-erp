import { normalizeDesignOptionKey } from "./design-icon-catalog";

/**
 * Real reference-photo pipeline for the Product Design step's attribute
 * pickers — per the user's own explicit choice (over the faster, free
 * "bigger clipart icons" option, given a competitor reference showing real
 * photos): a genuinely generic, template-driven prompt (not a hand-authored
 * entry per option value — there are 150+ distinct values across the whole
 * catalog, growing every time a category is added) means any option value
 * can get a real reference photo with zero code changes when a new
 * category/attribute is added later.
 *
 * Deliberately DEDUPES BY VALUE ONLY, not (attribute, value) — the same
 * concept string (e.g. "Round Neck") means the same real garment detail
 * regardless of which field/category it's attached to, so it gets exactly
 * one photo, reused everywhere that value appears (same reasoning already
 * proven by the sibling clipart-icon system this augments).
 */

/** Filesystem/URL-safe slug for a design-option value — same normalization as the icon system, then made filename-safe. */
export function slugifyDesignOptionValue(value: string): string {
  return normalizeDesignOptionKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Public URL a generated reference photo for this value is expected to live at — may or may not actually exist yet (the caller falls back to the clipart icon via onError if it 404s). */
export function referenceImageUrlForValue(value: string): string {
  return `/ai-designer-reference/${slugifyDesignOptionValue(value)}.jpg`;
}

/**
 * The single, generic text-to-image prompt template every reference photo
 * is generated from — deliberately option-value-only (no attribute/category
 * context folded in), since the option string itself is normally
 * unambiguous ("Deep Back Cut-Out", "Halter") and staying generic is what
 * keeps this a template rather than 150+ hand-tuned prompts.
 */
export function buildReferenceImagePrompt(optionValue: string): string {
  return `Photo-realistic fashion catalogue reference photo clearly illustrating the garment design detail "${optionValue}". Show a close-up, unambiguous view of this specific design detail on a real garment worn by a fashion model, plain neutral studio background, soft professional studio lighting, no text, no logos, no watermark, no other competing design details visible. The photo must make this exact style instantly recognizable to a merchandiser at a glance.`;
}

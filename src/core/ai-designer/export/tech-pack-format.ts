import { STANDARD_SIZES } from "@/core/ai-designer/tech-pack/schema";

/** Deliberately looser than the Zod-inferred `TechPackMeasurementPoint` — this module also serves `tech-pack-pdf.tsx`'s own hand-maintained `TechPackAnalysisForPdf` mirror type (`values: Record<string, string>`, since a persisted JSON blob is read back loosely-typed), so it only requires the shape it actually needs rather than coupling to one specific caller's stricter type. */
interface GradeableMeasurementPoint {
  pointName: string;
  values: Record<string, string>;
}

/**
 * Pure, deterministic PDF-formatting helpers for the Tech Pack export — no AI
 * calls, no database access. Kept as a sibling of tech-pack-pdf.tsx (not
 * inside it) so this logic is independently unit-testable without pulling in
 * @react-pdf/renderer's own render pipeline.
 */

const LEADING_NUMBER_PATTERN = /-?\d+(\.\d+)?/;

/** Extracts the leading numeric token from a measurement string like "57 cm"/"57cm"/"57.5 cm" — null for "TBC"/empty/non-numeric. */
function parseLeadingNumber(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(LEADING_NUMBER_PATTERN);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export interface GradeRuleRow {
  pointName: string;
  grade: string;
}

/**
 * Page 6 ("Size Grading") must show genuinely different, DERIVED content
 * from Page 5's own raw measurement table — never a second copy of the same
 * numbers. For each point, computes the delta between every adjacent pair of
 * `sizes` (default STANDARD_SIZES) from the already-real, already-required
 * `values` on that point. A pure computation, never a second AI call — any
 * unparseable value renders "—" for that point rather than crashing, and a
 * genuinely non-linear grade (deltas that disagree beyond a small tolerance)
 * is reported honestly rather than averaged into a misleading single number.
 */
export function computeGradeRules(points: GradeableMeasurementPoint[], sizes: readonly string[] = STANDARD_SIZES): GradeRuleRow[] {
  return points.map((point) => {
    const numericValues = sizes.map((size) => parseLeadingNumber(point.values[size]));

    if (numericValues.some((v) => v === null) || numericValues.length < 2) {
      return { pointName: point.pointName, grade: "—" };
    }

    const deltas: number[] = [];
    for (let i = 1; i < numericValues.length; i++) {
      deltas.push((numericValues[i] as number) - (numericValues[i - 1] as number));
    }

    const first = deltas[0];
    const isConsistent = deltas.every((d) => Math.abs(d - first) < 0.05);
    if (!isConsistent) return { pointName: point.pointName, grade: "Non-linear — see full chart" };

    const rounded = Math.round(first * 100) / 100;
    return { pointName: point.pointName, grade: `${rounded >= 0 ? "+" : ""}${rounded} cm` };
  });
}

/** A small set of common garment color names, for when the AI can't (or the schema doesn't) supply a hex estimate. Matched case-insensitively as a substring, never presented as an exact/confirmed value beyond what a name-only estimate already is. */
const COMMON_COLOR_NAME_HEX: Record<string, string> = {
  "navy blue": "#1F2A44",
  navy: "#1F2A44",
  maroon: "#800000",
  "olive green": "#556B2F",
  olive: "#556B2F",
  charcoal: "#36454F",
  "off-white": "#F5F5F0",
  "off white": "#F5F5F0",
  cream: "#FFFDD0",
  khaki: "#C3B091",
  burgundy: "#800020",
  "forest green": "#228B22",
  mustard: "#E1AD01",
  teal: "#008080",
  rust: "#B7410E",
  black: "#000000",
  white: "#FFFFFF",
  grey: "#808080",
  gray: "#808080",
  beige: "#F5F5DC",
  "denim blue": "#1560BD",
  denim: "#1560BD",
  coral: "#FF7F50",
  "blush pink": "#FEC5E5",
  blush: "#FEC5E5",
  "sky blue": "#87CEEB",
};

const HEX_PATTERN = /#([0-9A-Fa-f]{6})\b/;

/**
 * Resolves a real hex color for a swatch chip — first from an explicit
 * AI-estimated hex string (if it actually contains a valid #RRGGBB), then
 * from a common-color-name lookup, else null (render text-only, exactly like
 * before this feature existed). The one shared implementation for every
 * swatch chip in the redesigned PDF, replacing what was previously a
 * one-off inline regex match used only for the Visible Colors table.
 */
export function resolveColorHex(input: { hexEstimate?: string | null; colorName?: string | null }): string | null {
  const hexMatch = input.hexEstimate?.match(HEX_PATTERN);
  if (hexMatch) return `#${hexMatch[1]}`;

  const name = input.colorName?.trim().toLowerCase();
  if (!name) return null;

  if (COMMON_COLOR_NAME_HEX[name]) return COMMON_COLOR_NAME_HEX[name];
  const matchedKey = Object.keys(COMMON_COLOR_NAME_HEX).find((key) => name.includes(key));
  return matchedKey ? COMMON_COLOR_NAME_HEX[matchedKey] : null;
}

/** For the BOM table's swatch column — best-effort case-insensitive substring match of a BOM row's free-text color against the analysis's own Visible Colors list, then resolves that match's hex the same way. */
export function findColorHexForBomRow(bomColor: string, visibleColors: { colorName: string; hexEstimate: string }[]): string | null {
  const needle = bomColor.trim().toLowerCase();
  if (!needle) return null;
  const match = visibleColors.find((c) => c.colorName.toLowerCase().includes(needle) || needle.includes(c.colorName.toLowerCase()));
  return match ? resolveColorHex(match) : null;
}

// Deliberately NOT anchored to string-start/newline — the AI returns
// `foldingInstructions` as one continuous string, so a real numbered list
// like "1. Fold sleeves. 2. Fold sides." has no newline between markers.
// Still a narrow, specific signal (a digit immediately followed by "." or
// ")" then whitespace), not "split on every period" — combined with the
// "at least twice" requirement below, this rejects both plain prose and an
// incidental single "N. "/"N) " occurrence.
/**
 * The callout-image box's own fixed content-width/height in PDF points —
 * A4 width (595.28pt, confirmed directly from @react-pdf/renderer's own
 * PAGE_SIZES constant) minus the page's 24pt padding on each side, and the
 * fixed height already used by tech-pack-pdf.tsx's `calloutImageWrapper`
 * style. Exported as the single source of truth for both that style value
 * and the pin-position math below, so the two can never silently drift
 * apart.
 */
export const CALLOUT_BOX_WIDTH_PT = 547.28;
export const CALLOUT_BOX_HEIGHT_PT = 220;

export interface ImageDisplayRect {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

/**
 * Computes the CSS `object-fit: contain` displayed sub-rectangle of an
 * image inside a box, as percentages of the box's own dimensions (0-100).
 * Needed because the AI estimates a seam callout's position as a percentage
 * of the REAL PHOTO's own pixel dimensions — but that photo is displayed
 * inside a fixed-size box via `objectFit: "contain"`, which letterboxes it
 * (centers it with empty margins on either the left/right or top/bottom)
 * whenever the photo's own aspect ratio differs from the box's. Without
 * this correction, a pin would be drawn using the box's own raw 0-100%
 * space and would land in the empty letterbox margin instead of on the
 * garment. Falls back to "no letterboxing" (the box is fully the image) if
 * any dimension is unknown/zero — the safest assumption when real
 * dimensions aren't available.
 */
export function computeContainFitRect(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): ImageDisplayRect {
  if (!imageWidth || !imageHeight || !boxWidth || !boxHeight) {
    return { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 };
  }
  const imageAspect = imageWidth / imageHeight;
  const boxAspect = boxWidth / boxHeight;

  if (imageAspect > boxAspect) {
    // Image is proportionally wider than the box -> fills the full width, letterboxed top/bottom.
    const displayedHeightPercent = ((boxWidth / imageAspect) / boxHeight) * 100;
    return { xPercent: 0, yPercent: (100 - displayedHeightPercent) / 2, widthPercent: 100, heightPercent: displayedHeightPercent };
  }
  // Image is proportionally taller/narrower than the box (the common case for a portrait fashion photo) -> fills the full height, letterboxed left/right.
  const displayedWidthPercent = ((boxHeight * imageAspect) / boxWidth) * 100;
  return { xPercent: (100 - displayedWidthPercent) / 2, yPercent: 0, widthPercent: displayedWidthPercent, heightPercent: 100 };
}

/** Maps an AI-estimated callout position (0-100%, relative to the real photo's own pixels) into the box's own 0-100% coordinate space, accounting for the `computeContainFitRect` letterboxing above. */
export function mapCalloutPositionToBoxPercent(pos: { xPercent: number; yPercent: number }, rect: ImageDisplayRect): { left: number; top: number } {
  return {
    left: rect.xPercent + (pos.xPercent / 100) * rect.widthPercent,
    top: rect.yPercent + (pos.yPercent / 100) * rect.heightPercent,
  };
}

const NUMBERED_STEP_PATTERN = /\d+[.)]\s+/g;

/**
 * Only splits `foldingInstructions` into a numbered-step list when the
 * source text ALREADY contains clear, unambiguous numbered separators
 * (at least twice) — otherwise returns null so the caller renders one plain
 * paragraph. Never invents step boundaries that aren't really there (e.g.
 * never splits on sentence-ending periods alone).
 */
export function tryParseNumberedSteps(text: string): string[] | null {
  const matches = text.match(NUMBERED_STEP_PATTERN);
  if (!matches || matches.length < 2) return null;

  const steps = text
    .split(NUMBERED_STEP_PATTERN)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return steps.length >= 2 ? steps : null;
}

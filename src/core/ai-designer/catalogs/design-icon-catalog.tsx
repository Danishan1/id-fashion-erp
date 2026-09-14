/**
 * Clipart-style icon system for AI Designer's "Product Design" wizard step
 * (direct user feedback: plain `<select>` dropdowns for garment attributes
 * like Neckline/Sleeve/Silhouette were hard to picture — an icon makes the
 * shape instantly recognizable).
 *
 * Deliberately keyed by the OPTION VALUE STRING (normalized: trimmed +
 * lowercased), never by (category, field, option) — the same value (e.g.
 * "Round Neck", "Slim", "Zipper") means the same real garment concept
 * regardless of which category's field it's attached to in
 * `design-attribute-catalog.ts`, so it gets exactly one icon, reused
 * everywhere that value appears.
 *
 * Every icon is a small, consistent inline SVG (24x24 viewBox, `currentColor`
 * stroke so it themes correctly in light/dark mode and inside a selected/
 * unselected button) — simple line-art, not photorealistic, matching this
 * module's own "clean, professional, low-decoration" visual language. A
 * value with no bespoke icon below falls back to a plain, clearly labeled
 * generic placeholder shape (never a blank/broken image) — see
 * `DesignOptionIcon`.
 */

import { useState, type ReactNode } from "react";
import { referenceImageUrlForValue } from "./reference-image-prompt";

// Bumped from 1.4/h-7 w-7 (28px) after direct user feedback that the icons
// were too small/thin to tell apart at a glance -- doubled the render size
// and thickened the stroke to match, plus a fixed-color backdrop chip (see
// `Svg` below) so every icon reads as a small colored badge rather than a
// thin gray scratch, regardless of the button's own selected/unselected
// state. Deliberately still simple line-art (not a photo/AI-generated
// image) -- the user's own explicit choice, since this ships immediately
// with no per-icon rework or AI-provider cost, vs. an alternative pass that
// would generate a real reference image per option value.
const STROKE = 1.75;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The glyph's own color is fixed (text-indigo-*), deliberately NOT
      // inherited from the button's text color the way it was on the first
      // pass -- a selected button (solid indigo-600 background, white text)
      // made a `currentColor` glyph turn white too, which was nearly
      // invisible against the light `indigo-50` backdrop circle below.
      // Fixing the glyph's own color independently of selection state keeps
      // it legible either way, and the button's own background/ring already
      // signals selection on its own.
      className="h-9 w-9 text-indigo-700 sm:h-11 sm:w-11 dark:text-indigo-300"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11.4" stroke="none" className="fill-indigo-50 dark:fill-indigo-950/50" />
      {children}
    </svg>
  );
}

export function normalizeDesignOptionKey(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Neckline / collar group — one shared torso body; only the neckline path
// (and an optional decorative overlay) varies. `necklinePath` is a set of SVG
// path commands that must start exactly at (5,8) [left shoulder, i.e. the
// point already reached by the shared "M4 17 L5 8" prefix] and end exactly at
// (19,8) [right shoulder].
// ---------------------------------------------------------------------------
function neckIcon(necklinePath: string, extra?: ReactNode) {
  return (
    <Svg>
      <path d={`M4 17 L5 8 ${necklinePath} L20 17 Z`} />
      {extra}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Sleeve group — one shared torso+round-neck body; only the two arm paths
// vary (mirrored left/right). Arms are optional (sleeveless has none).
// ---------------------------------------------------------------------------
const SLEEVE_TORSO = "M9 17 L9 6 Q12 9 15 6 L15 17 Z";
function sleeveIcon(leftArm?: string, rightArm?: string, extra?: ReactNode) {
  return (
    <Svg>
      <path d={SLEEVE_TORSO} />
      {leftArm && <path d={leftArm} />}
      {rightArm && <path d={rightArm} />}
      {extra}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Fit / silhouette group — a single garment-outline path per shape.
// ---------------------------------------------------------------------------
function fitIcon(path: string, extra?: ReactNode) {
  return (
    <Svg>
      <path d={path} />
      {extra}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Length group — a "ruler" style icon: a faint reference body-line plus a
// bold horizontal marker at the hem height, so the same visual language
// works whether the value describes a dress, kurta, or pant hem.
// ---------------------------------------------------------------------------
function lengthIcon(hemY: number, footed?: boolean) {
  return (
    <Svg>
      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="1.4 2" opacity={0.3} />
      <path d={`M9 4 L9 ${hemY} L15 ${hemY} L15 4`} opacity={0.5} />
      <line x1="7.5" y1={hemY} x2="16.5" y2={hemY} strokeWidth={2.2} />
      {footed && <path d={`M9 ${hemY} Q9 ${hemY + 2} 12 ${hemY + 2} Q15 ${hemY + 2} 15 ${hemY}`} />}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Rise / waistband-height group.
// ---------------------------------------------------------------------------
function riseIcon(bandY: number) {
  return (
    <Svg>
      <path d="M8 21 L9 9 L15 9 L16 21" />
      <line x1="8.7" y1={bandY} x2="15.3" y2={bandY} strokeWidth={2.2} />
    </Svg>
  );
}

function beltedIcon() {
  return (
    <Svg>
      <path d="M8 21 L9 9 L15 9 L16 21" />
      <rect x="8.3" y="9.6" width="7.4" height="2" rx="0.4" />
      <rect x="11.2" y="10" width="1.6" height="1.2" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Closure group.
// ---------------------------------------------------------------------------
function zipperIcon(partial?: boolean) {
  return (
    <Svg>
      <rect x="10.4" y="3.5" width="3.2" height="2.2" rx="0.5" />
      <line x1="12" y1="5.5" x2="12" y2="20" />
      <line x1="9.5" y1="7" x2="14.5" y2="8.6" />
      <line x1="9.5" y1="10" x2="14.5" y2="11.6" />
      {!partial && <line x1="9.5" y1="13" x2="14.5" y2="14.6" />}
      {!partial && <line x1="9.5" y1="16" x2="14.5" y2="17.6" />}
    </Svg>
  );
}

function buttonIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="6" />
      <circle cx="10" cy="10.5" r="0.6" fill="currentColor" />
      <circle cx="14" cy="10.5" r="0.6" fill="currentColor" />
      <circle cx="10" cy="13.5" r="0.6" fill="currentColor" />
      <circle cx="14" cy="13.5" r="0.6" fill="currentColor" />
    </Svg>
  );
}

function snapIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </Svg>
  );
}

function drawstringIcon() {
  return (
    <Svg>
      <line x1="6" y1="8" x2="18" y2="8" />
      <line x1="10" y1="8" x2="9.3" y2="18" />
      <line x1="14" y1="8" x2="14.7" y2="18" />
      <circle cx="9.3" cy="19" r="1" fill="currentColor" />
      <circle cx="14.7" cy="19" r="1" fill="currentColor" />
    </Svg>
  );
}

function elasticIcon() {
  return (
    <Svg>
      <path d="M4 12 Q6 8 8 12 Q10 16 12 12 Q14 8 16 12 Q18 16 20 12" />
    </Svg>
  );
}

function pullOnIcon() {
  return (
    <Svg>
      <path d="M5 13 Q7 10 9 13 Q11 16 12 13 Q13 10 15 13 Q17 16 19 13" />
      <path d="M12 18 L12 8 M9 11 L12 8 L15 11" opacity={0.85} />
    </Svg>
  );
}

function pulloverIcon() {
  return (
    <Svg>
      <path d="M4 17 L5 8 Q12 12 19 8 L20 17 Z" />
      <path d="M12 3 L12 9 M9 6 L12 3 L15 6" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Pocket group.
// ---------------------------------------------------------------------------
const TORSO_GUIDE = "M4 21 L5 8 L19 8 L20 21 Z";
function noPocketIcon() {
  return (
    <Svg>
      <rect x="8" y="8" width="8" height="8" rx="1" opacity={0.4} />
      <line x1="7" y1="7" x2="17" y2="17" />
    </Svg>
  );
}
function chestPocketIcon() {
  return (
    <Svg>
      <path d="M4 17 L5 8 L19 8 L20 17 Z" opacity={0.25} />
      <rect x="9.5" y="9" width="5" height="4" rx="0.5" />
    </Svg>
  );
}
function doubleChestPocketIcon() {
  return (
    <Svg>
      <path d="M4 17 L5 8 L19 8 L20 17 Z" opacity={0.25} />
      <rect x="7" y="9" width="4" height="3.5" rx="0.5" />
      <rect x="13" y="9" width="4" height="3.5" rx="0.5" />
    </Svg>
  );
}
function slantPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <path d="M8 12 L14 12 L12 18 L7 18 Z" />
    </Svg>
  );
}
function cargoPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <rect x="8" y="13" width="8" height="6" rx="0.5" />
      <path d="M8 13 L9 11 L15 11 L16 13" />
    </Svg>
  );
}
function weltPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <rect x="8" y="12.3" width="8" height="1.4" rx="0.5" fill="currentColor" />
    </Svg>
  );
}
function patchPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <rect x="8" y="12" width="8" height="7" rx="0.6" strokeDasharray="1.6 1.6" />
    </Svg>
  );
}
function flapPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <rect x="8" y="13" width="8" height="5" rx="0.6" />
      <path d="M7.5 13 L8.5 11 L15.5 11 L16.5 13 Z" />
    </Svg>
  );
}
function zipPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <rect x="8" y="12" width="8" height="6" rx="0.6" />
      <line x1="12" y1="12" x2="12" y2="18" />
    </Svg>
  );
}
function kangarooPocketIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <path d="M6 14 Q12 11 18 14 L17 20 L7 20 Z" />
      <line x1="12" y1="14" x2="12" y2="20" />
    </Svg>
  );
}
function sidePocketsIcon() {
  return (
    <Svg>
      <path d={TORSO_GUIDE} opacity={0.25} />
      <line x1="6.2" y1="13" x2="5.6" y2="17" />
      <line x1="17.8" y1="13" x2="18.4" y2="17" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Cuff group.
// ---------------------------------------------------------------------------
function buttonCuffIcon() {
  return (
    <Svg>
      <rect x="7" y="8" width="10" height="6" rx="1" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
    </Svg>
  );
}
function roundedCuffIcon() {
  return (
    <Svg>
      <rect x="7" y="8" width="10" height="6" rx="3" />
    </Svg>
  );
}
function frenchCuffIcon() {
  return (
    <Svg>
      <rect x="7" y="6.5" width="10" height="4" rx="1" />
      <rect x="7" y="11" width="10" height="4" rx="1" />
      <circle cx="12" cy="13" r="0.8" fill="currentColor" />
    </Svg>
  );
}
function ribbedCuffIcon() {
  return (
    <Svg>
      <rect x="7" y="8" width="10" height="6" rx="1" />
      <line x1="9" y1="8" x2="9" y2="14" />
      <line x1="12" y1="8" x2="12" y2="14" />
      <line x1="15" y1="8" x2="15" y2="14" />
    </Svg>
  );
}
function plainCuffIcon() {
  return (
    <Svg>
      <rect x="7" y="8" width="10" height="6" rx="1" />
    </Svg>
  );
}
function openHemIcon() {
  return (
    <Svg>
      <line x1="6" y1="12" x2="18" y2="12" />
      <path d="M6 12 L5.3 13.4 M9 12 L8.3 13.4 M12 12 L11.3 13.4 M15 12 L14.3 13.4 M18 12 L17.3 13.4" opacity={0.6} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Hem group.
// ---------------------------------------------------------------------------
function straightHemIcon() {
  return (
    <Svg>
      <path d="M7 5 L7 18 L17 18 L17 5" opacity={0.5} />
      <line x1="7" y1="18" x2="17" y2="18" strokeWidth={2.2} />
    </Svg>
  );
}
function curvedHemIcon() {
  return (
    <Svg>
      <path d="M7 5 L7 15 L17 15 L17 5" opacity={0.5} />
      <path d="M7 15 Q12 19 17 15" strokeWidth={2.2} />
    </Svg>
  );
}
function shirtTailHemIcon() {
  return (
    <Svg>
      <path d="M7 5 L7 14 M17 5 L17 14" opacity={0.5} />
      <path d="M7 14 Q9 17 12 16 Q15 17 17 14" strokeWidth={2} />
    </Svg>
  );
}
function peplumIcon() {
  return (
    <Svg>
      <path d="M8 5 L8 13 L16 13 L16 5" opacity={0.5} />
      <path d="M6 13 Q9 18 12 14 Q15 18 18 13" strokeWidth={2} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Wash group.
// ---------------------------------------------------------------------------
function lightWashIcon() {
  return (
    <Svg>
      <rect x="6" y="5" width="12" height="14" rx="1" />
      <line x1="8" y1="7" x2="10" y2="9" opacity={0.5} />
    </Svg>
  );
}
function mediumWashIcon() {
  return (
    <Svg>
      <rect x="6" y="5" width="12" height="14" rx="1" />
      <line x1="7" y1="7" x2="10" y2="10" />
      <line x1="10" y1="7" x2="13" y2="10" />
      <line x1="13" y1="7" x2="16" y2="10" />
    </Svg>
  );
}
function darkWashIcon() {
  return (
    <Svg>
      <rect x="6" y="5" width="12" height="14" rx="1" fill="currentColor" opacity={0.15} />
      <line x1="7" y1="7" x2="17" y2="17" />
      <line x1="7" y1="11" x2="13" y2="17" />
      <line x1="7" y1="15" x2="9" y2="17" />
      <line x1="11" y1="7" x2="17" y2="13" />
      <line x1="15" y1="7" x2="17" y2="9" />
    </Svg>
  );
}
function blackIcon() {
  return (
    <Svg>
      <rect x="6" y="5" width="12" height="14" rx="1" fill="currentColor" />
    </Svg>
  );
}
function rawDenimIcon() {
  return (
    <Svg>
      <rect x="6" y="5" width="12" height="14" rx="1" />
      <line x1="8" y1="5" x2="8" y2="19" strokeWidth={2} />
      <line x1="10" y1="7" x2="13" y2="10" opacity={0.5} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Side slit group.
// ---------------------------------------------------------------------------
function slitIcon(mode: "none" | "side" | "front") {
  return (
    <Svg>
      <path d="M8 5 L7 19 L17 19 L16 5" opacity={0.5} />
      {mode === "side" && <line x1="16.5" y1="12" x2="15.5" y2="19" strokeWidth={1.8} />}
      {mode === "front" && <line x1="12" y1="12" x2="12" y2="19" strokeWidth={1.8} />}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Hood type group.
// ---------------------------------------------------------------------------
function hoodIcon(mode: "attached" | "drawstring" | "none") {
  return (
    <Svg>
      <path d="M4 17 L5 8 Q12 12 19 8 L20 17 Z" />
      {mode !== "none" && <path d="M6 9 Q12 2.2 18 9" opacity={0.75} />}
      {mode === "drawstring" && (
        <>
          <line x1="10" y1="9" x2="9.3" y2="14" />
          <line x1="14" y1="9" x2="14.7" y2="14" />
        </>
      )}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Back style group.
// ---------------------------------------------------------------------------
function backStyleIcon(mode: "regular" | "deep" | "tie") {
  return (
    <Svg>
      <path d="M4 17 L5 6 L19 6 L20 17 Z" />
      {mode === "deep" && <path d="M8 6 Q12 14 16 6" />}
      {mode === "tie" && (
        <>
          <line x1="8" y1="10" x2="16" y2="14" />
          <line x1="16" y1="10" x2="8" y2="14" />
        </>
      )}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Buttons / hardware-finish group (Shirt only).
// ---------------------------------------------------------------------------
function hornFinishIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="6" />
      <path d="M8 9 Q12 7 16 9 M8 15 Q12 17 16 15" opacity={0.6} />
      <circle cx="10" cy="11" r="0.5" fill="currentColor" />
      <circle cx="14" cy="13" r="0.5" fill="currentColor" />
    </Svg>
  );
}
function concealedPlacketIcon() {
  return (
    <Svg>
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
      <path d="M9 4 L15 4 M9 20 L15 20" opacity={0.4} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Print placement group.
// ---------------------------------------------------------------------------
function printIcon(front: boolean, back: boolean) {
  return (
    <Svg>
      <path d="M5 17 L6 6 L18 6 L19 17 Z" opacity={0.4} />
      {front && <rect x="10.2" y="9" width="3.6" height="3.6" rx="0.6" fill="currentColor" />}
      {back && <path d="M9.5 12.5 L12 10 L14.5 12.5 L13.3 13.7 L12 12.4 L10.7 13.7 Z" fill="currentColor" />}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Bottom (leg-shape) group extras not already covered by fit/silhouette.
// ---------------------------------------------------------------------------
function taperedIcon() {
  return (
    <Svg>
      <path d="M9 5 L9.5 14 L10.5 19 L13.5 19 L14.5 14 L15 5 Z" />
    </Svg>
  );
}
function wideLegIcon() {
  return (
    <Svg>
      <path d="M8 5 L6 19 L10.5 19 L11.3 5 Z" />
      <path d="M12.7 5 L13.5 19 L18 19 L16 5 Z" />
    </Svg>
  );
}
function joggerCuffIcon() {
  return (
    <Svg>
      <path d="M9 5 L10 16 L10 19 L14 19 L14 16 L15 5" />
      <line x1="9.6" y1="16" x2="14.4" y2="16" strokeWidth={2} />
    </Svg>
  );
}
function openBottomIcon() {
  return (
    <Svg>
      <path d="M9 5 L9.5 19 L14.5 19 L15 5" />
    </Svg>
  );
}
function footedIcon() {
  return (
    <Svg>
      <path d="M9 5 L9.5 17 Q9.5 20 12 20 Q14.5 20 14.5 17 L15 5" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Top style / bottom style / set type — simple garment pictograms.
// ---------------------------------------------------------------------------
function shirtGlyph() {
  return (
    <Svg>
      <path d="M8 6 L5 8 L7 11 L8 9 L8 20 L16 20 L16 9 L17 11 L19 8 L16 6 L14 7.5 L10 7.5 Z" />
    </Svg>
  );
}
function tshirtGlyph() {
  return (
    <Svg>
      <path d="M8 6 L5 9 L7.5 11.5 L8.5 9.5 L8.5 20 L15.5 20 L15.5 9.5 L16.5 11.5 L19 9 L16 6 Q12 8.5 8 6 Z" />
    </Svg>
  );
}
function cropTopGlyph() {
  return (
    <Svg>
      <path d="M8 7 L8 14 L16 14 L16 7 M9 7 L9 5 M15 7 L15 5" />
    </Svg>
  );
}
function blouseGlyph() {
  return (
    <Svg>
      <path d="M8 6 L5 9 L7.5 11 L8 9.5 Q8 15 9 20 L15 20 Q16 15 16 9.5 L16.5 11 L19 9 L16 6 Q12 8 8 6 Z" />
    </Svg>
  );
}
function pantGlyph() {
  return (
    <Svg>
      <path d="M8 5 L7.5 19 L10.5 19 L12 8 L13.5 19 L16.5 19 L16 5 Z" />
    </Svg>
  );
}
function skirtGlyph() {
  return (
    <Svg>
      <path d="M10 5 L6 19 L18 19 L14 5 Z" />
    </Svg>
  );
}
function shortsGlyph() {
  return (
    <Svg>
      <path d="M8 5 L7 14 L10.5 14 L12 9 L13.5 14 L17 14 L16 5 Z" />
    </Svg>
  );
}
function topBottomSetGlyph() {
  return (
    <Svg>
      <path d="M8 4 L5 6.5 L7 8.5 L8 7 L8 12 L16 12 L16 7 L17 8.5 L19 6.5 L16 4 Q12 6 8 4 Z" />
      <path d="M9 13.5 L8.5 20 L11 20 L12 15.5 L13 20 L15.5 20 L15 13.5 Z" />
    </Svg>
  );
}
function sleepGownGlyph() {
  return (
    <Svg>
      <path d="M9 5 L7 8 L8 20 L16 20 L17 8 L15 5 Q12 7 9 5 Z" />
    </Svg>
  );
}
function onePieceGlyph() {
  return (
    <Svg>
      <path d="M8 5 L6 8 L8 10 L8.5 8.5 Q8 13 8.5 19 L11 19 L12 14 L13 19 L15.5 19 Q16 13 15.5 8.5 L16 10 L18 8 L16 5 Q12 7.5 8 5 Z" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Generic fallback — always a clear, non-blank placeholder shape.
// ---------------------------------------------------------------------------
function genericIcon() {
  return (
    <Svg>
      <rect x="6" y="6" width="12" height="12" rx="2" strokeDasharray="2 2" opacity={0.6} />
      <path d="M9 6 L9 4 L15 4 L15 6" opacity={0.6} />
    </Svg>
  );
}

/**
 * Every distinct option value across `PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY`
 * that has a real, purpose-built icon. Keys are normalized (see
 * `normalizeDesignOptionKey`) — exact lowercase of the option string as
 * authored in the catalog, punctuation included.
 */
const ICONS: Record<string, ReactNode> = {
  // --- Neckline / collar ---
  "round neck": neckIcon("Q12 13 19 8"),
  "v-neck": neckIcon("L12 14 L19 8"),
  "square neck": neckIcon("L9 8 L9 11 L15 11 L15 8 L19 8"),
  "boat neck": neckIcon("Q12 9.5 19 8"),
  "sweetheart": neckIcon("Q8 13 12 10 Q16 13 19 8"),
  "crew neck": neckIcon("Q12 11 19 8"),
  "polo collar": neckIcon("L9 8 L11 10.5 L13 8.7 L15 10.5 L19 8"),
  "henley": neckIcon(
    "Q12 13 19 8",
    <>
      <line x1="12" y1="10" x2="12" y2="16" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
      <circle cx="12" cy="14.5" r="0.5" fill="currentColor" />
    </>
  ),
  "mandarin": neckIcon("Q12 12 19 8", <path d="M9 8 L9 6 L15 6 L15 8" />),
  "mandarin collar": neckIcon("Q12 12 19 8", <path d="M9 8 L9 6 L15 6 L15 8" />),
  "chinese collar": neckIcon("Q12 12 19 8", <path d="M9 8 L9 6 L15 6 L15 8" />),
  "notch lapel": neckIcon("L7 8 L12 13.5 L17 8 L19 8"),
  "shawl collar": neckIcon("Q9 12 12 9.5 Q15 12 19 8"),
  "peter pan collar": neckIcon(
    "Q12 12 19 8",
    <>
      <path d="M7 8 Q9.5 10.5 12 9" />
      <path d="M17 8 Q14.5 10.5 12 9" />
    </>
  ),
  "envelope neck": neckIcon("Q12 12 19 8", <line x1="8" y1="9" x2="16" y2="12" opacity={0.6} />),
  "classic": neckIcon("L9 8 L12 11.5 L15 8 L19 8"),
  "spread": neckIcon("L8 8 L12 11 L16 8 L19 8"),
  "cuban": neckIcon("Q7 10.5 9.5 9 L12 9.8 L14.5 9 Q17 10.5 19 8"),
  "button-down": neckIcon(
    "L9 8 L12 11.5 L15 8 L19 8",
    <>
      <circle cx="9.5" cy="8.6" r="0.5" fill="currentColor" />
      <circle cx="14.5" cy="8.6" r="0.5" fill="currentColor" />
    </>
  ),
  "hooded": neckIcon("Q12 12 19 8", <path d="M6 9 Q12 2.5 18 9" opacity={0.7} />),
  "halter": (
    <Svg>
      <path d="M8 17 L8 11 L12 6 L16 11 L16 17 Z" />
      <line x1="10.3" y1="10" x2="12" y2="6" />
      <line x1="13.7" y1="10" x2="12" y2="6" />
    </Svg>
  ),
  "off-shoulder": (
    <Svg>
      <path d="M4 17 L4 11 L8 9 L16 9 L20 11 L20 17 Z" />
    </Svg>
  ),

  // --- Sleeve ---
  "sleeveless": sleeveIcon(
    undefined,
    undefined,
    <>
      <path d="M9 6 Q7.5 8 9 10" opacity={0.5} />
      <path d="M15 6 Q16.5 8 15 10" opacity={0.5} />
    </>
  ),
  "cap sleeve": sleeveIcon("M9 6 L6.5 7.5 L9 9 Z", "M15 6 L17.5 7.5 L15 9 Z"),
  "short sleeve": sleeveIcon("M9 6 L6 9 L9 10.5 Z", "M15 6 L18 9 L15 10.5 Z"),
  "half sleeve": sleeveIcon("M9 6 L5 11 L9 12.5 Z", "M15 6 L19 11 L15 12.5 Z"),
  "three-quarter sleeve": sleeveIcon("M9 6 L4 14 L9 14.5 Z", "M15 6 L20 14 L15 14.5 Z"),
  "full sleeve": sleeveIcon("M9 6 L3 18 L7 18.5 L9 12 Z", "M15 6 L21 18 L17 18.5 L15 12 Z"),
  "roll-up sleeve": sleeveIcon(
    "M9 6 L3 18 L7 18.5 L9 12 Z",
    "M15 6 L21 18 L17 18.5 L15 12 Z",
    <>
      <line x1="4" y1="13" x2="8" y2="13.5" />
      <line x1="20" y1="13" x2="16" y2="13.5" />
    </>
  ),
  "raglan sleeve": sleeveIcon(
    "M9 6 L5 11 L9 12.5 Z",
    "M15 6 L19 11 L15 12.5 Z",
    <>
      <line x1="9" y1="6" x2="7" y2="10" opacity={0.6} />
      <line x1="15" y1="6" x2="17" y2="10" opacity={0.6} />
    </>
  ),
  "puff sleeve": sleeveIcon("M9 6 Q4 9 6.5 12 L9 11 Z", "M15 6 Q20 9 17.5 12 L15 11 Z"),
  "bell sleeve": sleeveIcon("M9 6 L6 11 L3 16 L7.5 17 L9 12 Z", "M15 6 L18 11 L21 16 L16.5 17 L15 12 Z"),

  // --- Fit / silhouette ---
  "slim": fitIcon("M9 5 L9.5 12 L9 19 L15 19 L14.5 12 L15 5 Z"),
  "regular": fitIcon("M8 5 L8 19 L16 19 L16 5 Z"),
  "relaxed": fitIcon("M7 5 L6.5 19 L17.5 19 L17 5 Z"),
  "oversized": fitIcon("M5 6 L5 19 L19 19 L19 6 Z"),
  "skinny": fitIcon("M9.5 5 L10 19 L14 19 L14.5 5 Z"),
  "bootcut": fitIcon("M9 5 L9.5 15 L7 19 L17 19 L14.5 15 L15 5 Z"),
  "straight": fitIcon("M9 5 L9 19 L15 19 L15 5 Z"),
  "fitted": fitIcon("M9 5 Q8 10 9 15 L9.5 19 L14.5 19 L15 15 Q16 10 15 5 Z"),
  "loose": fitIcon("M7 5 L7 19 L17 19 L17 5 Z"),
  "crop": fitIcon("M8 5 L8 12 L16 12 L16 5 Z"),
  "muscle fit": fitIcon("M7 5 L8.5 10 L9 19 L15 19 L15.5 10 L17 5 Z"),
  "a-line": fitIcon("M9 5 L6 19 L18 19 L15 5 Z"),
  "bodycon": fitIcon("M8 5 Q10 12 9 19 L15 19 Q14 12 16 5 Z"),
  "fit & flare": fitIcon("M9 5 L9.5 13 L6 19 L18 19 L14.5 13 L15 5 Z"),
  "wrap": fitIcon("M9 5 L6 19 L18 19 L15 5 Z", <line x1="9" y1="5" x2="14" y2="19" opacity={0.6} />),
  "shift": fitIcon("M8 5 L7.5 19 L16.5 19 L16 5 Z"),
  "straight / pencil": fitIcon("M9 5 L9 19 L15 19 L15 5 Z"),
  "flared": fitIcon("M9 5 L8 12 L5 19 L19 19 L16 12 L15 5 Z"),
  "layered": fitIcon("M9 5 L6 19 L18 19 L15 5 Z", <line x1="7" y1="14" x2="17" y2="14" opacity={0.6} />),
  "anarkali": fitIcon("M9 5 L9.5 11 L4 19 L20 19 L14.5 11 L15 5 Z"),
  "pleated": fitIcon(
    "M9 5 L7 19 L17 19 L15 5 Z",
    <>
      <line x1="10.5" y1="6" x2="9.7" y2="18" opacity={0.6} />
      <line x1="12" y1="6" x2="12" y2="18" opacity={0.6} />
      <line x1="13.5" y1="6" x2="14.3" y2="18" opacity={0.6} />
    </>
  ),

  // --- Hem ---
  "straight hem": straightHemIcon(),
  "curved hem": curvedHemIcon(),
  "shirt-tail hem": shirtTailHemIcon(),
  "peplum": peplumIcon(),

  // --- Buttons / hardware finish (Shirt only) ---
  "standard plastic": buttonIcon(),
  "horn-finish": hornFinishIcon(),
  "metal snap": snapIcon(),
  "concealed placket": concealedPlacketIcon(),

  // --- Print placement ---
  "no print": printIcon(false, false),
  "front print": printIcon(true, false),
  "back print": printIcon(false, true),
  "front & back print": printIcon(true, true),

  // --- Rise ---
  "low rise": riseIcon(13),
  "mid rise": riseIcon(11),
  "high rise": riseIcon(9),

  // --- Bottom (leg shape) extras ---
  "tapered": taperedIcon(),
  "wide leg": wideLegIcon(),
  "jogger cuff": joggerCuffIcon(),
  "open bottom": openBottomIcon(),
  "footed": footedIcon(),

  // --- Closure ---
  "zip fly": zipperIcon(),
  "button fly": buttonIcon(),
  "drawstring": drawstringIcon(),
  "elastic waist": elasticIcon(),
  "zipper": zipperIcon(),
  "button": buttonIcon(),
  "pull-on": pullOnIcon(),
  "snap button": snapIcon(),
  "pullover": pulloverIcon(),
  "zip-up": zipperIcon(),
  "half zip": zipperIcon(true),

  // --- Length ---
  "full length": lengthIcon(21),
  "ankle length": lengthIcon(19),
  "cropped": lengthIcon(17),
  "capri": lengthIcon(18),
  "short kurta": lengthIcon(11),
  "knee length": lengthIcon(14),
  "below knee": lengthIcon(15),
  "mini": lengthIcon(9),
  "midi": lengthIcon(16),
  "maxi": lengthIcon(20),
  "above knee": lengthIcon(11),
  "bermuda": lengthIcon(13),
  "short": lengthIcon(11),
  "hip length": lengthIcon(12),
  "long": lengthIcon(19),

  // --- Wash ---
  "light wash": lightWashIcon(),
  "medium wash": mediumWashIcon(),
  "dark wash": darkWashIcon(),
  "black": blackIcon(),
  "raw denim": rawDenimIcon(),

  // --- Side slit ---
  "no slit": slitIcon("none"),
  "side slit": slitIcon("side"),
  "front slit": slitIcon("front"),

  // --- Waist (Elastic Waist / Drawstring already covered above) ---
  "belted": beltedIcon(),
  "high waist": riseIcon(9),
  "mid waist": riseIcon(11),

  // --- Hood type ---
  "attached hood": hoodIcon("attached"),
  "drawstring hood": hoodIcon("drawstring"),
  "no hood": hoodIcon("none"),

  // --- Back style ---
  "regular back": backStyleIcon("regular"),
  "deep back": backStyleIcon("deep"),
  "tie-back": backStyleIcon("tie"),

  // --- Top style ---
  "shirt": shirtGlyph(),
  "crop top": cropTopGlyph(),
  "t-shirt": tshirtGlyph(),
  "blouse": blouseGlyph(),

  // --- Bottom style ---
  "pant": pantGlyph(),
  "skirt": skirtGlyph(),
  "shorts": shortsGlyph(),

  // --- Set type ---
  "top & bottom set": topBottomSetGlyph(),
  "sleep gown": sleepGownGlyph(),
  "one-piece": onePieceGlyph(),

  // --- Pocket ---
  "no pocket": noPocketIcon(),
  "single chest pocket": chestPocketIcon(),
  "double chest pocket": doubleChestPocketIcon(),
  "chest pocket": chestPocketIcon(),
  "slant pocket": slantPocketIcon(),
  "cargo pocket": cargoPocketIcon(),
  "welt pocket": weltPocketIcon(),
  "patch pocket": patchPocketIcon(),
  "flap pocket": flapPocketIcon(),
  "zip pocket": zipPocketIcon(),
  "kangaroo pocket": kangarooPocketIcon(),
  "side pockets": sidePocketsIcon(),

  // --- Cuff ---
  "button cuff": buttonCuffIcon(),
  "rounded cuff": roundedCuffIcon(),
  "french cuff": frenchCuffIcon(),
  "ribbed cuff": ribbedCuffIcon(),
  "plain cuff": plainCuffIcon(),
  "open hem": openHemIcon(),
};

/**
 * Renders the clipart-style icon for one Product Design option value. Falls
 * back to a plain, clearly-not-broken generic placeholder shape for any
 * value not in the bespoke `ICONS` map above — the option's own text label is
 * always rendered alongside this by the caller, so a fallback never reads as
 * unlabeled.
 */
export function DesignOptionIcon({ value }: { value: string }) {
  return <>{ICONS[normalizeDesignOptionKey(value)] ?? genericIcon()}</>;
}

/**
 * Prefers a real reference photo (see reference-image-prompt.ts's generic,
 * template-driven generation pipeline) over the clipart icon above — falls
 * back to `DesignOptionIcon` via the plain `<img onError>` technique the
 * moment a real photo hasn't been generated for this value yet (or fails to
 * load for any other reason), so a value with no photo yet never shows a
 * broken image. Deliberately built this way (not a server-side existence
 * check / manifest) so newly-generated photos "light up" automatically the
 * next time this component mounts, with zero code change needed.
 */
/** Download URL for a company-uploaded reference-photo override (see AiDesignerOptionReferenceImage) — reuses the same generic, company-scoped attachment route every other AI Designer photo goes through. */
export function optionReferenceImageOverrideUrl(attachmentId: string): string {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

/**
 * Three-tier fallback: an admin-uploaded photo override for this exact
 * option value (if one exists, via `overrideAttachmentId`) beats the
 * AI-generated static photo, which beats the clipart icon — matching the
 * schema doc comment on AiDesignerOptionReferenceImage. `overrideAttachmentId`
 * is optional so every existing caller (which has no override map to check)
 * keeps working unchanged.
 */
export function DesignOptionImage({ value, overrideAttachmentId }: { value: string; overrideAttachmentId?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) return <DesignOptionIcon value={value} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small, per-option reference thumbnail from a growing generated/uploaded set, not a Next-optimizable static asset.
    <img
      src={overrideAttachmentId ? optionReferenceImageOverrideUrl(overrideAttachmentId) : referenceImageUrlForValue(value)}
      alt={value}
      className="h-16 w-16 rounded object-cover sm:h-20 sm:w-20"
      onError={() => setImageFailed(true)}
    />
  );
}

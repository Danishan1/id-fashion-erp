/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output — stored on every AiGarmentFabricApplicationRun/
 * AiGarmentFabricApplication row, same auditability reasoning as every
 * other AI Garment Flow process's own PROMPT_VERSION.
 */
export const FABRIC_APPLICATION_PROMPT_VERSION = "fabric-application-v1";

export interface FabricApplicationContext {
  composition?: string | null;
  width?: string | null;
  gsm?: string | null;
  wovenOrKnit?: string | null;
  stretch?: string | null;
  drape?: string | null;
  transparency?: string | null;
  surfaceCharacter?: string | null;
  printPattern?: string | null;
  directionality?: string | null;
  specialPlacement?: string | null;
}

/**
 * "Never require the user to guess unknown technical information" — a
 * field left blank on the form is substituted with this instruction rather
 * than an empty string, so the model is explicitly told to infer
 * conservatively from the swatch image itself instead of being handed a
 * blank line it might interpret as "this attribute doesn't exist."
 */
const NOT_SPECIFIED = "Not specified — infer conservatively from the swatch image itself, do not invent an exact technical value.";

/**
 * The hidden AI image prompt. Verbatim per the product brief; never shown
 * to end users, never free-typed by a user — the form only ever collects
 * the individual textile fields, substituted in here server-side.
 *
 * The spec's own template names exactly 9 "Known textile information"
 * placeholders (Composition/Width/GSM/Stretch/Drape/Transparency/Surface/
 * Pattern/Special Placement) — Woven/Knit and Directionality are collected
 * on the form too but are not part of that fixed template. Both are
 * genuinely visually load-bearing (construction type drives drape/stretch
 * behaviour; directionality drives stripe/check alignment, which the
 * template's own "Preserve... stripe direction, check direction" instruction
 * directly depends on), so they're appended as a short additional-detail
 * paragraph after the verbatim block rather than silently dropped — the
 * same "fixed template + an appended optional paragraph" shape already used
 * by Process 4's own additionalInstructions handling.
 */
export function buildFabricApplicationPrompt(ctx: FabricApplicationContext): string {
  const lines = [
    "Apply the uploaded fabric swatch to the selected garment.",
    "",
    "Preserve the approved garment design.",
    "",
    "Do not redesign:",
    "",
    "silhouette",
    "neckline",
    "sleeve",
    "length",
    "collar",
    "seams",
    "pockets",
    "closures",
    "proportions",
    "",
    "unless necessary for physically realistic fabric behaviour.",
    "",
    "Use the uploaded textile as the visual fabric reference.",
    "",
    "Preserve as accurately as possible:",
    "",
    "colour",
    "motif",
    "print character",
    "print scale",
    "stripe direction",
    "check direction",
    "texture",
    "surface appearance",
    "",
    "Known textile information:",
    "",
    "Composition:",
    ctx.composition || NOT_SPECIFIED,
    "",
    "Width:",
    ctx.width || NOT_SPECIFIED,
    "",
    "GSM:",
    ctx.gsm || NOT_SPECIFIED,
    "",
    "Stretch:",
    ctx.stretch || NOT_SPECIFIED,
    "",
    "Drape:",
    ctx.drape || NOT_SPECIFIED,
    "",
    "Transparency:",
    ctx.transparency || NOT_SPECIFIED,
    "",
    "Surface:",
    ctx.surfaceCharacter || NOT_SPECIFIED,
    "",
    "Pattern:",
    ctx.printPattern || NOT_SPECIFIED,
    "",
    "Special Placement:",
    ctx.specialPlacement || NOT_SPECIFIED,
    "",
    "Represent the textile realistically.",
    "",
    "Do not make lightweight fluid fabric behave like heavy structured cloth.",
    "",
    "Do not make stiff fabric behave like chiffon.",
    "",
    "Create a realistic commercial garment-development visual.",
  ];

  const extra: string[] = [];
  if (ctx.wovenOrKnit) extra.push(`Construction: ${ctx.wovenOrKnit}`);
  if (ctx.directionality) extra.push(`Directionality: ${ctx.directionality}`);
  if (extra.length > 0) {
    lines.push("", "Additional textile construction details:", ...extra);
  }

  return lines.join("\n");
}

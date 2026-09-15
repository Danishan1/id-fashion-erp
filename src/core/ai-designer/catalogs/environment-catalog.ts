/**
 * Fixed, built-in catalog for AI Designer's Environment screen (the
 * photoshoot setting the generated garment visual is placed in). Each
 * entry's promptHint is the scene description substituted into the hidden
 * image-generation prompt — never shown to the user as raw prompt text, only
 * as the plain option label. A user may instead type a fully custom
 * environment description (isCustomEnvironment: true on AiDesignerProject) —
 * that free text is used directly in place of a promptHint.
 */

export interface EnvironmentDef {
  key: string;
  label: string;
  promptHint: string;
}

export const ENVIRONMENTS: EnvironmentDef[] = [
  { key: "STUDIO_WHITE", label: "Studio White", promptHint: "a clean seamless white studio background with even, soft lighting" },
  { key: "LUXURY_STUDIO", label: "Luxury Studio", promptHint: "an upscale photography studio with soft directional lighting and a subtly textured backdrop" },
  { key: "BEACH", label: "Beach", promptHint: "a sunlit beach setting with soft sand and ocean visible in the background" },
  { key: "STREET", label: "Street", promptHint: "an urban street setting with a realistic city backdrop and natural daylight" },
  { key: "CAFE", label: "Cafe", promptHint: "a cozy cafe interior with warm ambient lighting" },
  { key: "OFFICE", label: "Office", promptHint: "a modern office interior with clean lines and natural light" },
  { key: "AIRPORT", label: "Airport", promptHint: "a contemporary airport terminal setting with travel-ready ambience" },
  { key: "RUNWAY", label: "Runway", promptHint: "a fashion runway setting with focused stage lighting" },
  { key: "WEDDING", label: "Wedding", promptHint: "a festive wedding setting with rich decor and warm ambient lighting" },
  { key: "FOREST", label: "Forest", promptHint: "a lush forest setting with dappled natural light through trees" },
  { key: "MOUNTAINS", label: "Mountains", promptHint: "a scenic mountain backdrop with crisp natural daylight" },
  { key: "SNOW", label: "Snow", promptHint: "a snowy outdoor setting with soft winter daylight" },
  { key: "DESERT", label: "Desert", promptHint: "a warm desert landscape with golden natural light" },
  { key: "GYM", label: "Gym", promptHint: "a modern gym interior with equipment softly visible in the background" },
  { key: "POOL", label: "Pool", promptHint: "a poolside setting with clear water and bright daylight" },
  { key: "LUXURY_HOTEL", label: "Luxury Hotel", promptHint: "an elegant luxury hotel interior with refined decor and warm lighting" },
  { key: "RESTAURANT", label: "Restaurant", promptHint: "an upscale restaurant interior with warm, intimate lighting" },
  { key: "NIGHT_CITY", label: "Night City", promptHint: "a city street at night with ambient street lighting and soft bokeh" },
  { key: "HOME", label: "Home", promptHint: "a comfortable, naturally lit home interior setting" },
];

export function getEnvironmentByKey(key: string): EnvironmentDef | undefined {
  return ENVIRONMENTS.find((e) => e.key === key);
}

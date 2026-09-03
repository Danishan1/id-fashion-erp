/**
 * Suggests a business code from a display name (e.g. "Royal Jeans" -> "ROYAL-JEANS").
 * Used to pre-fill the Code field on create forms — always user-editable afterwards.
 */
export function suggestCodeFromName(name: string, prefix = ""): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned ? `${prefix}${cleaned}`.slice(0, 20) : "";
}

/**
 * Disambiguates a suggested code against codes already in use — e.g. two
 * shades that legitimately share a Name (and even a Pantone, when the same
 * colour is achievable via more than one dye process) shouldn't collide on
 * an auto-filled Code the user never meant to make identical. Appends
 * "-2", "-3", ... until unique; always user-editable afterwards regardless.
 */
export function makeCodeUnique(baseCode: string, existingCodes: Iterable<string>): string {
  if (!baseCode) return baseCode;
  const taken = new Set(existingCodes);
  if (!taken.has(baseCode)) return baseCode;
  let suffix = 2;
  while (taken.has(`${baseCode}-${suffix}`)) suffix++;
  return `${baseCode}-${suffix}`;
}

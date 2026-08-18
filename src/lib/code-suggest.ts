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

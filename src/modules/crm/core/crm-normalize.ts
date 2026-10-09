/**
 * Normalisers shared by every CRM record so duplicate detection and search
 * behave identically for leads, contacts and companies.
 */

/** Lower-cased, trimmed email, or null when blank. */
export function emailKey(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Comparable phone key: digits only, last 10 digits (so "+91 98765 43210",
 * "098765 43210" and "9876543210" match). Numbers with fewer than 7 digits are
 * ignored — too short to be a reliable duplicate signal.
 */
export function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** "  Nordic   Threads AB " → "nordic threads ab" */
export function nameKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function uniqueKeys(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

export function fullNameOf(firstName: string, lastName?: string | null): string {
  return [firstName.trim(), lastName?.trim()].filter(Boolean).join(" ");
}

/** One lower-cased string to run `contains` searches against. */
export function buildSearchText(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

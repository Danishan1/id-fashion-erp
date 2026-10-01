/**
 * Turns a mapped incoming record (target field → raw value, from a file
 * row, an API body or a webhook payload) into clean lead input strings,
 * collecting row-level messages. Pure and client-safe; database lookups
 * (status / source / owner by name) happen later in the ingestion service.
 *
 * Rules are deliberately conservative — "don't unnecessarily modify
 * business data":
 *  - whitespace is trimmed and collapsed; configured empty tokens ("N/A",
 *    "NULL", "-", …) become empty
 *  - emails are lower-cased; a second email in the same cell moves to the
 *    alternate email when that is empty
 *  - phones keep digits and a leading "+"; "00" becomes "+" and an
 *    11-digit trunk "0" prefix is dropped. No country code is ever guessed
 *    (same rule as src/lib/communication.ts) — duplicate matching uses the
 *    last 10 digits regardless
 *  - person names are re-cased only when they arrive in ALL CAPS or all
 *    lower case; company names are never re-cased
 */

export interface IngestMessage {
  level: "error" | "warning" | "info";
  field?: string;
  message: string;
}

export interface NormalizeOptions {
  /** Cell values treated as empty (compared case-insensitively). */
  emptyTokens?: string[];
  /** Re-case person names that are entirely upper or lower case. Default true. */
  fixNameCase?: boolean;
  /** How to read ambiguous dd/mm vs mm/dd dates. Default DMY (India). */
  dateOrder?: "DMY" | "MDY";
}

export const DEFAULT_EMPTY_TOKENS = ["n/a", "na", "null", "nil", "none", "-", "--", "—", "not available", "#n/a"];

export type NormalizedLeadValues = Partial<Record<string, string | number | string[] | null>> & { customFields?: Record<string, unknown> };

export interface NormalizeResult {
  values: NormalizedLeadValues;
  messages: IngestMessage[];
}

const TEXT_TARGETS = [
  "firstName",
  "lastName",
  "designation",
  "companyName",
  "industry",
  "city",
  "state",
  "country",
  "requirement",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "campaignSource",
  "referralSource",
  "externalId",
  "status",
  "source",
  "owner",
];
const PHONE_TARGETS = ["phone", "mobile", "whatsapp"];

function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function cleanText(v: unknown, emptyTokens: string[], { multiline = false } = {}): string {
  let s = toText(v).replace(/ /g, " ");
  s = multiline ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  s = s.trim();
  if (!s) return "";
  return emptyTokens.includes(s.toLowerCase()) ? "" : s;
}

export function titleCaseIfUniform(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return name;
  if (letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'\-.(])([a-z])/g, (_, p, c: string) => p + c.toUpperCase());
}

/** "+91 98765-43210" → "+919876543210"; "09876543210" → "9876543210"; "0091…" → "+91…". Returns null when it can't be a phone. */
export function normalizePhone(raw: string): { value: string | null; problem?: string } {
  const s = raw.trim();
  if (!s) return { value: null };
  if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) return { value: null, problem: `"${s}" looks like a number the spreadsheet shortened — format the column as text and export again` };
  const plus = s.startsWith("+");
  let digits = s.replace(/[^\d]/g, "");
  let international = plus;
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  } else if (!plus && /^0[6-9]\d{9}$/.test(digits)) {
    // Domestic trunk "0" in front of a 10-digit mobile number. Landlines keep
    // their STD code as written; duplicate matching uses the last 10 digits.
    digits = digits.slice(1);
  }
  if (digits.length < 7 || digits.length > 15) return { value: null, problem: `"${s}" is not a valid phone number` };
  return { value: international ? `+${digits}` : digits };
}

const EMAIL_SPLIT = /[\s,;/|]+/;

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[₹$€£¥]|\b(inr|usd|eur|gbp|rs\.?|rupees?)\b/gi, "").replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Accepts ISO dates/datetimes, d/m/y (or m/d/y), "5 Oct 2026", "Oct 5, 2026". Returns an ISO string or null. */
export function parseDateValue(raw: string, order: "DMY" | "MDY" = "DMY"): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00+05:30` : s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const build = (y: number, m: number, d: number, time = "00:00") => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    // Reject impossible dates (31/02) instead of letting them roll over.
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${time.padStart(5, "0")}:00+05:30`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}:\d{2}))?$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return order === "DMY" ? build(Number(m[3]), b, a, m[4]) : build(Number(m[3]), a, b, m[4]);
  }
  const month = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()];
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})$/);
  if (m && month(m[2])) return build(Number(m[3]), month(m[2]), Number(m[1]));
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m && month(m[1])) return build(Number(m[3]), month(m[1]), Number(m[2]));
  return null;

}

const TEMPERATURES: Record<string, "HOT" | "WARM" | "COLD"> = { hot: "HOT", high: "HOT", warm: "WARM", medium: "WARM", med: "WARM", cold: "COLD", low: "COLD" };

/** `mapped` is target field key → raw value; custom fields arrive as `cf:<key>`. */
export function normalizeLeadRecord(mapped: Record<string, unknown>, options: NormalizeOptions = {}): NormalizeResult {
  const empty = (options.emptyTokens ?? DEFAULT_EMPTY_TOKENS).map((t) => t.trim().toLowerCase());
  const fixCase = options.fixNameCase ?? true;
  const messages: IngestMessage[] = [];
  const v: NormalizedLeadValues = {};
  const text = (k: string, multiline = false) => cleanText(mapped[k], empty, { multiline });

  for (const k of TEXT_TARGETS) {
    if (!(k in mapped)) continue;
    const t = text(k, k === "requirement");
    if (t) v[k] = t;
  }

  // Names
  const full = text("fullName");
  if (full && !v.firstName) {
    const parts = full.split(" ");
    v.firstName = parts[0];
    if (parts.length > 1 && !v.lastName) v.lastName = parts.slice(1).join(" ");
  }
  if (fixCase) {
    for (const k of ["firstName", "lastName"]) if (typeof v[k] === "string") v[k] = titleCaseIfUniform(v[k] as string);
  }
  if (!v.firstName && v.companyName) {
    v.firstName = v.companyName as string;
    messages.push({ level: "warning", field: "firstName", message: "No person name — the company name is used as the lead name." });
  }

  // Emails
  for (const k of ["email", "alternateEmail"]) {
    if (!(k in mapped)) continue;
    const t = text(k).replace(/^mailto:/i, "").replace(/^<|>$/g, "");
    if (!t) continue;
    const parts = t.split(EMAIL_SPLIT).filter(Boolean).map((p) => p.toLowerCase());
    v[k] = parts[0];
    if (parts.length > 1) {
      if (k === "email" && !text("alternateEmail")) {
        v.alternateEmail = parts[1];
        messages.push({ level: "info", field: "email", message: `Two emails found — "${parts[1]}" was saved as the alternate email.` });
      } else messages.push({ level: "warning", field: k, message: `More than one email in this field — only "${parts[0]}" was kept.` });
    }
  }

  // Phones
  for (const k of PHONE_TARGETS) {
    if (!(k in mapped)) continue;
    const t = text(k);
    if (!t) continue;
    const [first, ...rest] = t.split(/\s*[,;/|]\s*/).filter(Boolean);
    const { value, problem } = normalizePhone(first);
    if (problem) messages.push({ level: "error", field: k, message: `${problem}.` });
    else if (value) v[k] = value;
    if (rest.length) messages.push({ level: "warning", field: k, message: `More than one number in this field — only the first was kept.` });
  }

  // Numbers
  for (const k of ["estimatedValue", "score"]) {
    if (!(k in mapped)) continue;
    const t = text(k);
    if (!t) continue;
    const n = parseNumber(t);
    if (n === null) messages.push({ level: "error", field: k, message: `"${t}" is not a number.` });
    else v[k] = n;
  }
  const currency = text("currencyCode").toUpperCase();
  if (currency) {
    if (/^[A-Z]{3}$/.test(currency)) v.currencyCode = currency;
    else messages.push({ level: "warning", field: "currencyCode", message: `"${currency}" is not a 3-letter currency code and was ignored.` });
  }

  const temp = text("temperature");
  if (temp) {
    const t = TEMPERATURES[temp.toLowerCase()];
    if (t) v.temperature = t;
    else messages.push({ level: "warning", field: "temperature", message: `Unknown temperature "${temp}" was ignored (use Hot, Warm or Cold).` });
  }

  for (const k of ["nextFollowUpAt", "lastContactedAt"]) {
    const t = text(k);
    if (!t) continue;
    const iso = parseDateValue(t, options.dateOrder);
    if (iso) v[k] = iso;
    else messages.push({ level: "warning", field: k, message: `"${t}" is not a date we recognise and was ignored.` });
  }

  const tags = text("tags");
  if (tags) {
    const list = [...new Set(tags.split(/\s*[,;|]\s*/).map((t) => t.trim().slice(0, 40)).filter(Boolean))];
    if (list.length) v.tags = list.slice(0, 20);
  }

  const custom: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(mapped)) {
    if (!k.startsWith("cf:")) continue;
    const t = Array.isArray(raw) || typeof raw === "boolean" || typeof raw === "number" ? raw : cleanText(raw, empty, { multiline: true });
    if (t !== "" && t !== null && t !== undefined) custom[k.slice(3)] = t;
  }
  if (Object.keys(custom).length) v.customFields = custom;

  return { values: v, messages };
}

import type { SendOutcome } from "./provider-contract";

/** Shared HTTP helpers for API-based adapters. */

export const SEND_TIMEOUT_MS = 20_000;
export const TEST_TIMEOUT_MS = 10_000;

/** Connection failures where the request certainly never reached the provider. */
const NEVER_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET_BEFORE_SEND", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"]);

export type HttpResult = { ok: true; status: number; headers: Headers; text: string } | { ok: false; outcome: Exclude<SendOutcome, { kind: "ACCEPTED" }> };

/**
 * POST / GET with a timeout. A thrown error is classified: DNS / refused /
 * certificate problems happen before anything is sent → RETRYABLE; a timeout
 * or a dropped connection may be after the provider got it → UNKNOWN.
 */
export async function request(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs = SEND_TIMEOUT_MS): Promise<HttpResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { ok: true, status: res.status, headers: res.headers, text };
  } catch (e) {
    const err = e as { name?: string; code?: string; cause?: { code?: string } };
    const code = err.cause?.code ?? err.code ?? "";
    if (err.name !== "AbortError" && NEVER_SENT_CODES.has(code)) return { ok: false, outcome: { kind: "RETRYABLE", code: "PROVIDER_UNREACHABLE", message: "The provider could not be reached." } };
    return { ok: false, outcome: { kind: "UNKNOWN", code: err.name === "AbortError" ? "TIMEOUT" : "CONNECTION_LOST", message: "No response from the provider — it may or may not have accepted the message." } };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Retry-After (seconds or HTTP date) → ms, bounded to [1s, 1h]. */
export function retryAfterMs(headers: Headers, fallbackMs = 60_000, now = Date.now()): number {
  const raw = headers.get("retry-after");
  let ms = fallbackMs;
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) ms = secs * 1000;
    else {
      const t = Date.parse(raw);
      if (Number.isFinite(t)) ms = t - now;
    }
  }
  return Math.min(3_600_000, Math.max(1_000, ms));
}

/**
 * Default status classification for JSON APIs. 503 = the provider refused
 * the request (retry); other 5xx are ambiguous (it may have been processed).
 */
export function classifyHttp(status: number, headers: Headers, code: string, message: string): SendOutcome {
  if (status === 401 || status === 403) return { kind: "CONNECTION", code: "AUTH_FAILED", message: "The provider rejected the credentials.", providerStatus: String(status) };
  if (status === 429) return { kind: "THROTTLED", code: "RATE_LIMITED", message: "The provider asked us to slow down.", retryAfterMs: retryAfterMs(headers), providerStatus: "429" };
  if (status === 503) return { kind: "RETRYABLE", code: "PROVIDER_UNAVAILABLE", message: "The provider is temporarily unavailable.", providerStatus: "503" };
  if (status >= 500) return { kind: "UNKNOWN", code: "PROVIDER_ERROR", message: "The provider returned an error after receiving the message — it may or may not be sent.", providerStatus: String(status) };
  return { kind: "PERMANENT", code: code || "REJECTED", message: message.slice(0, 300) || "The provider refused the message.", providerStatus: String(status) };
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/;
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** Phone → country code + number digits (no +). A number without + needs an explicit default country code. */
export function normalizePhone(raw: string, defaultCountryCode: string | number | undefined): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[\s\-().]/g, "");
  let out: string;
  if (digits.startsWith("+")) out = digits.slice(1);
  else if (digits.startsWith("00")) out = digits.slice(2);
  else {
    const cc = String(defaultCountryCode ?? "").replace(/\D/g, "");
    if (!cc) return null;
    out = cc + digits.replace(/^0+/, "");
  }
  return /^[1-9]\d{7,14}$/.test(out) ? out : null;
}

export const str = (v: string | number | undefined) => (v == null ? "" : String(v).trim());

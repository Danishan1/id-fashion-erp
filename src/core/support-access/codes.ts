import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Verification codes and exchange tokens for customer-approved support access
 * (Platform SaaS Phase 2). Codes are never stored in plain text — only an
 * HMAC bound to the record they belong to, so a leaked hash can't be replayed
 * against a different request.
 */

/** Pending request code lifetime — the customer must approve within this. */
export const ACCESS_CODE_TTL_MINUTES = 15;
/** Write-upgrade code lifetime. */
export const WRITE_CODE_TTL_MINUTES = 10;
/** Wrong-code attempts before the request (or write request) is locked. */
export const MAX_CODE_ATTEMPTS = 5;
/** Exchange token lifetime — long enough for one browser round trip. */
export const EXCHANGE_TOKEN_TTL_SECONDS = 60;
/** Business rule: support sessions last at most 2 hours. */
export const MAX_SUPPORT_SESSION_MINUTES = 120;
export const SUPPORT_SESSION_DURATIONS = [15, 30, 60, 120] as const;

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is not set.");
  return value;
}

/** A cryptographically random 6-digit code, e.g. "042917". */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** `scope` separates the access code from the write code of the same record. */
export function hashVerificationCode(scope: "access" | "write", recordId: string, code: string): string {
  return createHmac("sha256", secret()).update(`${scope}:${recordId}:${code}`).digest("hex");
}

export function verificationCodeMatches(
  scope: "access" | "write",
  recordId: string,
  code: string,
  storedHash: string
): boolean {
  const candidate = Buffer.from(hashVerificationCode(scope, recordId, code.trim()), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function generateExchangeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashExchangeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

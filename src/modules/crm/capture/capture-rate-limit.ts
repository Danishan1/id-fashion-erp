import { LRUCache } from "lru-cache";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/**
 * Fixed-window request limiter for the public capture endpoints (API key /
 * webhook endpoint). In-memory like the login limiter
 * (src/core/auth/rateLimiter.ts) — fine for this single-instance
 * deployment; swap for a Redis-backed limiter when running several instances.
 */
const WINDOW_MS = 60_000;
const windows = new LRUCache<string, { start: number; count: number }>({ max: 10_000, ttl: WINDOW_MS });

export function assertCaptureRateLimit(bucket: string, limitPerMinute: number, now = Date.now()) {
  const w = windows.get(bucket);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(bucket, { start: now, count: 1 });
    return;
  }
  w.count += 1;
  if (w.count > limitPerMinute) {
    throw new BusinessRuleError("RATE_LIMITED", `Too many requests — at most ${limitPerMinute} per minute. Try again shortly.`);
  }
}

/**
 * Phase 16 (S&M API): same fixed window, but reports the remaining allowance
 * and the reset time so the API can send X-RateLimit-* / Retry-After headers.
 */
export function checkRateLimit(bucket: string, limitPerMinute: number, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
  let w = windows.get(bucket);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0 };
    windows.set(bucket, w);
  }
  w.count += 1;
  return { allowed: w.count <= limitPerMinute, remaining: Math.max(0, limitPerMinute - w.count), resetAt: w.start + WINDOW_MS };
}

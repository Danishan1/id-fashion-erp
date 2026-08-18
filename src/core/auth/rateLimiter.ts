import { LRUCache } from "lru-cache";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new LRUCache<string, number>({ max: 5000, ttl: LOCKOUT_MS });

/**
 * Simple in-memory login-attempt limiter. Adequate for a single-instance
 * deployment (this project's current shape); if this ever runs behind a load
 * balancer across multiple instances, swap this module for a Redis-backed
 * limiter (e.g. @upstash/ratelimit) — callers (auth.ts) don't need to change,
 * only this file's internals.
 */
export function assertNotLockedOut(identifier: string): void {
  const count = attempts.get(identifier) ?? 0;
  if (count >= MAX_ATTEMPTS) {
    throw new Error("Too many failed login attempts. Try again in 15 minutes.");
  }
}

export function recordFailedAttempt(identifier: string): void {
  attempts.set(identifier, (attempts.get(identifier) ?? 0) + 1);
}

export function clearAttempts(identifier: string): void {
  attempts.delete(identifier);
}

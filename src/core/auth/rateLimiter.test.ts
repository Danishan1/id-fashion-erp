import { describe, expect, it } from "vitest";
import { assertNotLockedOut, clearAttempts, recordFailedAttempt } from "./rateLimiter";

// Each test uses its own identifier — the underlying cache is a module-level
// singleton shared across every test in this file, so reusing an identifier
// would leak state between tests.

describe("rateLimiter", () => {
  it("allows an identifier with no recorded failures", () => {
    expect(() => assertNotLockedOut("user-a@example.com")).not.toThrow();
  });

  it("still allows access after fewer than 5 failed attempts", () => {
    const email = "user-b@example.com";
    for (let i = 0; i < 4; i++) recordFailedAttempt(email);
    expect(() => assertNotLockedOut(email)).not.toThrow();
  });

  it("locks out after the 5th failed attempt", () => {
    const email = "user-c@example.com";
    for (let i = 0; i < 5; i++) recordFailedAttempt(email);
    expect(() => assertNotLockedOut(email)).toThrow("Too many failed login attempts");
  });

  it("does not lock out a different identifier", () => {
    const attacker = "user-d@example.com";
    const bystander = "user-e@example.com";
    for (let i = 0; i < 5; i++) recordFailedAttempt(attacker);
    expect(() => assertNotLockedOut(bystander)).not.toThrow();
  });

  it("clearAttempts resets the counter so the identifier is allowed again", () => {
    const email = "user-f@example.com";
    for (let i = 0; i < 5; i++) recordFailedAttempt(email);
    expect(() => assertNotLockedOut(email)).toThrow();

    clearAttempts(email);
    expect(() => assertNotLockedOut(email)).not.toThrow();
  });
});

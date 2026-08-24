import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOAuthState, verifyOAuthState } from "./oauth-state";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-value-not-real";
});

describe("signOAuthState / verifyOAuthState", () => {
  it("round-trips the exact payload", () => {
    const state = signOAuthState({ companyId: "co-1", userId: "user-1", platform: "META" });
    const payload = verifyOAuthState(state);
    expect(payload).toMatchObject({ companyId: "co-1", userId: "user-1", platform: "META" });
  });

  it("rejects a tampered payload (changed companyId after signing)", () => {
    const state = signOAuthState({ companyId: "co-1", userId: "user-1", platform: "META" });
    const [, signature] = state.split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ companyId: "co-EVIL", userId: "user-1", platform: "META", issuedAt: Date.now() })).toString(
      "base64url"
    );
    expect(verifyOAuthState(`${tamperedBody}.${signature}`)).toBeNull();
  });

  it("rejects a state signed with a different secret", () => {
    const state = signOAuthState({ companyId: "co-1", userId: "user-1", platform: "GOOGLE" });
    process.env.NEXTAUTH_SECRET = "a-different-secret";
    expect(verifyOAuthState(state)).toBeNull();
  });

  it("rejects malformed state strings", () => {
    expect(verifyOAuthState("not-a-real-state")).toBeNull();
    expect(verifyOAuthState("")).toBeNull();
  });

  it("rejects an expired state (older than 10 minutes)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T10:00:00Z"));
    const state = signOAuthState({ companyId: "co-1", userId: "user-1", platform: "META" });

    vi.setSystemTime(new Date("2026-08-24T10:11:00Z"));
    expect(verifyOAuthState(state)).toBeNull();

    vi.useRealTimers();
  });
});

import { describe, expect, it } from "vitest";
import { GEMINI_DEFAULT_TIMEOUT_MS, resolveGeminiTimeoutMs } from "./config";

describe("resolveGeminiTimeoutMs", () => {
  it("uses a valid number or numeric string as-is", () => {
    expect(resolveGeminiTimeoutMs(90_000)).toBe(90_000);
    expect(resolveGeminiTimeoutMs("45000")).toBe(45_000);
  });

  it("falls back to the 120 s default (same as AIProvider.requestTimeoutMs) when missing or invalid", () => {
    expect(GEMINI_DEFAULT_TIMEOUT_MS).toBe(120_000);
    // "60s" must not be read as 60 ms; values under 1 s are treated as mistakes.
    for (const bad of [undefined, null, "", "  ", "60s", "abc", 0, -5, 500, Number.NaN]) {
      expect(resolveGeminiTimeoutMs(bad as number | string | null | undefined)).toBe(GEMINI_DEFAULT_TIMEOUT_MS);
    }
  });
});

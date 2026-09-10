import { describe, expect, it } from "vitest";
import { ImageGenConfigMissingError } from "@/core/ai/image-generation/config";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { classifyImageGenError, isFailoverEligible, FAILOVER_ELIGIBLE_CATEGORIES } from "./error-classification";

describe("classifyImageGenError", () => {
  const cases: [ImageGenerationServiceError["category"], string][] = [
    ["TIMEOUT", "TIMEOUT"],
    ["AUTH_FAILURE", "AUTH_ERROR"],
    ["RATE_LIMIT", "RATE_LIMITED"],
    ["CREDITS_EXHAUSTED", "QUOTA_EXHAUSTED"],
    ["UNSAFE_CONTENT", "CONTENT_POLICY"],
    ["PROVIDER_ERROR", "PROVIDER_UNAVAILABLE"],
    ["INVALID_IMAGE_RESPONSE", "PROVIDER_UNAVAILABLE"],
    ["UNSUPPORTED_OPERATION", "INTERNAL_ERROR"],
    ["MISSING_CONFIG", "INTERNAL_ERROR"],
  ];

  it.each(cases)("maps ImageGenErrorCategory %s to AIUsageErrorCategory %s", (imageGenCategory, expected) => {
    const err = new ImageGenerationServiceError("test message", imageGenCategory);
    const { category, message } = classifyImageGenError(err);
    expect(category).toBe(expected);
    expect(message).toBe("test message");
  });

  it("maps a missing-config error (a provider misconfiguration, not a real request failure) to INTERNAL_ERROR", () => {
    const { category } = classifyImageGenError(new ImageGenConfigMissingError("no key"));
    expect(category).toBe("INTERNAL_ERROR");
  });

  it("maps an unrecognized plain Error to INTERNAL_ERROR without losing its message", () => {
    const { category, message } = classifyImageGenError(new Error("boom"));
    expect(category).toBe("INTERNAL_ERROR");
    expect(message).toBe("boom");
  });
});

describe("isFailoverEligible — matches the exact requirement list", () => {
  it("is eligible for quota/rate-limit/provider-unavailable/timeout — the transient/capacity categories", () => {
    expect(isFailoverEligible("QUOTA_EXHAUSTED")).toBe(true);
    expect(isFailoverEligible("RATE_LIMITED")).toBe(true);
    expect(isFailoverEligible("PROVIDER_UNAVAILABLE")).toBe(true);
    expect(isFailoverEligible("TIMEOUT")).toBe(true);
  });

  it("is NOT eligible for auth/invalid-request/content-policy/internal-error — real operational problems a different provider cannot fix", () => {
    expect(isFailoverEligible("AUTH_ERROR")).toBe(false);
    expect(isFailoverEligible("INVALID_REQUEST")).toBe(false);
    expect(isFailoverEligible("CONTENT_POLICY")).toBe(false);
    expect(isFailoverEligible("INTERNAL_ERROR")).toBe(false);
  });

  it("the exported eligible set has exactly the 4 documented categories, no more, no fewer", () => {
    expect([...FAILOVER_ELIGIBLE_CATEGORIES].sort()).toEqual(["PROVIDER_UNAVAILABLE", "QUOTA_EXHAUSTED", "RATE_LIMITED", "TIMEOUT"].sort());
  });
});

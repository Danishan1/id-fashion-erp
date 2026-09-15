import type { AIUsageErrorCategory } from "@prisma/client";
import { ImageGenConfigMissingError } from "@/core/ai/image-generation/config";
import { ImageGenerationServiceError, type ImageGenErrorCategory } from "@/core/ai/image-generation/types";

/**
 * Maps the EXISTING, already-proven per-provider error classification
 * (ImageGenErrorCategory — produced by each provider file's own
 * `mapSdkError()`, e.g. openai.ts checking `RateLimitError.type ===
 * "insufficient_quota"`, gemini.ts checking the response body for
 * "quota|resource_exhausted", cloudflare.ts checking for "daily|neuron|quota"
 * in a 429 body) onto the failover-relevant AIUsageErrorCategory taxonomy.
 * Deliberately does NOT re-parse raw SDK errors itself — that logic
 * already exists, is already tested, and duplicating it here would be
 * exactly the "duplicate provider logic" this task was told not to build.
 */
export function classifyImageGenError(err: unknown): { category: AIUsageErrorCategory; message: string } {
  if (err instanceof ImageGenConfigMissingError) {
    // Should not normally be reachable — AIProviderManager filters a
    // provider out of the candidate list before ever calling it if its
    // stored config is incomplete (see buildCandidateList). Treated as an
    // internal/setup problem, not something failover papers over.
    return { category: "INTERNAL_ERROR", message: err.message };
  }
  if (err instanceof ImageGenerationServiceError) {
    return { category: mapImageGenCategory(err.category), message: err.message };
  }
  return { category: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error." };
}

function mapImageGenCategory(category: ImageGenErrorCategory): AIUsageErrorCategory {
  switch (category) {
    case "TIMEOUT":
      return "TIMEOUT";
    case "AUTH_FAILURE":
      return "AUTH_ERROR";
    case "RATE_LIMIT":
      return "RATE_LIMITED";
    case "CREDITS_EXHAUSTED":
      return "QUOTA_EXHAUSTED";
    case "UNSAFE_CONTENT":
      return "CONTENT_POLICY";
    case "PROVIDER_ERROR":
      return "PROVIDER_UNAVAILABLE";
    case "INVALID_IMAGE_RESPONSE":
      // The provider was reachable and answered, but the response itself was
      // unusable (no image, corrupt data) — treated as a provider-side
      // reliability problem, not a request-shape problem, so the next
      // candidate is worth trying.
      return "PROVIDER_UNAVAILABLE";
    case "UNSUPPORTED_OPERATION":
      // Reaching here means a provider was selected as a candidate for a
      // capability it does not actually support — a capability-declaration
      // bug in this provider's own AIProvider row, not a transient failure.
      // Never failover-eligible: silently trying the next provider would
      // mask the real misconfiguration (the offending provider should
      // simply never have been a candidate — see buildCandidateList).
      return "INTERNAL_ERROR";
    case "MISSING_CONFIG":
      return "INTERNAL_ERROR";
    default: {
      const exhaustive: never = category;
      void exhaustive;
      return "INTERNAL_ERROR";
    }
  }
}

/**
 * The ONLY categories AIProviderManager will automatically move to the next
 * candidate provider for — matches the explicit requirement list exactly:
 * HTTP 429 / quota exceeded / credits exhausted / rate limit / temporary
 * provider unavailable / 5xx / timeout / temporary network outage.
 *
 * Deliberately excludes AUTH_ERROR even though it is often provider-
 * specific (only that one provider's key is bad) — an invalid/expired API
 * key is a real operational problem an admin needs to see and fix, not
 * something failover should quietly paper over by switching to a different
 * provider (that would let a broken credential go unnoticed indefinitely).
 * INVALID_REQUEST/CONTENT_POLICY are properties of the request itself
 * (a malformed image, a policy-violating prompt) and would fail identically
 * on any other provider, so trying one is pointless. INTERNAL_ERROR means
 * this application's own code or configuration is broken, which retrying
 * against a different external provider can never fix.
 */
export const FAILOVER_ELIGIBLE_CATEGORIES: ReadonlySet<AIUsageErrorCategory> = new Set([
  "QUOTA_EXHAUSTED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
]);

export function isFailoverEligible(category: AIUsageErrorCategory): boolean {
  return FAILOVER_ELIGIBLE_CATEGORIES.has(category);
}

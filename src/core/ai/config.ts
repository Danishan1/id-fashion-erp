/**
 * AI provider configuration, read from environment variables so a model or
 * even the provider itself can change without touching application code
 * (see AI_PROVIDER/ANTHROPIC_DEFAULT_MODEL/ANTHROPIC_VISION_MODEL in
 * .env.example). Read lazily (not at module load) so a route can surface a
 * clean "configuration is missing" error instead of crashing at import time
 * when ANTHROPIC_API_KEY is unset — the common case in a fresh dev checkout.
 */

export class AiConfigMissingError extends Error { }

export interface AnthropicConfig {
  apiKey: string;
  defaultModel: string;
  visionModel: string;
}

export function getAnthropicConfig(): AnthropicConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiConfigMissingError("AI service configuration is missing.");
  }
  return {
    apiKey,
    defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    visionModel: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
  };
}

/**
 * AI_MODEL — the one top-level switch for which AI vendor this deployment
 * uses: "gpt" (OpenAI), "gemini" (Google) or "anthropic". When set it wins
 * over the older, narrower AI_TEXT_PROVIDER / IMAGE_GENERATION_PROVIDER
 * variables (kept as fallbacks for deployments that don't set AI_MODEL), and
 * each vendor uses its own credential: gpt → OPENAI_API_KEY, gemini →
 * GEMINI_API_KEY, anthropic → ANTHROPIC_API_KEY. Anthropic has no image
 * generation API, so with AI_MODEL=anthropic image generation keeps using
 * IMAGE_GENERATION_PROVIDER / the admin-configured providers.
 */
export type AiModelSetting = "gpt" | "gemini" | "anthropic";

export function getAiModelSetting(): AiModelSetting | null {
  const raw = process.env.AI_MODEL?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "gpt" || raw === "openai") return "gpt";
  if (raw === "gemini") return "gemini";
  if (raw === "anthropic" || raw === "claude") return "anthropic";
  throw new AiConfigMissingError(`AI_MODEL="${process.env.AI_MODEL}" is not supported — use "gpt", "gemini" or "anthropic".`);
}

export type AiTextProviderKind = "anthropic" | "openai" | "gemini";

/**
 * Selects which real backend `requestStructuredVisionOutput`/
 * `requestStructuredTextOutput` (src/core/ai/providers/anthropic.ts) actually
 * call — every AI Garment Flow / AI Designer process that does structured
 * text or vision analysis (Fabric Analysis, Reference Analysis, Development
 * Brief, Commercial Evaluation, BOM Suggestion, ...) goes through those two
 * functions, so flipping this one env var switches every one of them at
 * once. Defaults to "anthropic" (unchanged prior behavior for any deployment
 * that doesn't set this) — this project's own dev `.env` sets
 * AI_TEXT_PROVIDER=openai explicitly once the configured Anthropic account
 * ran out of credits, per the user's own choice to switch providers rather
 * than wait on billing, while keeping the Anthropic implementation itself
 * fully intact and one env-var flip away from being active again.
 */
export function getAiTextProvider(): AiTextProviderKind {
  const aiModel = getAiModelSetting();
  if (aiModel) return aiModel === "gpt" ? "openai" : aiModel;
  const value = process.env.AI_TEXT_PROVIDER;
  if (value === "openai" || value === "gemini") return value;
  return "anthropic";
}

export interface GeminiTextConfig {
  apiKey: string;
  defaultModel: string;
  visionModel: string;
}

export function getGeminiTextConfig(): GeminiTextConfig {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiConfigMissingError("AI service configuration is missing.");
  }
  return {
    apiKey,
    // One Flash model handles both text and vision. gemini-2.5-* is no longer
    // offered to new keys, and the Pro models have no free-tier quota.
    defaultModel: process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash",
    visionModel: process.env.GEMINI_VISION_MODEL || "gemini-3.8-flash",
  };
}

export interface OpenAiTextConfig {
  apiKey: string;
  defaultModel: string;
  visionModel: string;
}

export function getOpenAiTextConfig(): OpenAiTextConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiConfigMissingError("AI service configuration is missing.");
  }
  return {
    apiKey,
    // gpt-4o handles vision and text in the same Chat Completions call, so
    // one model name covers both by default — override independently only
    // if a deployment wants a cheaper/different model for the text-only path.
    defaultModel: process.env.OPENAI_TEXT_MODEL || "gpt-4o",
    visionModel: process.env.OPENAI_VISION_MODEL || "gpt-4o",
  };
}
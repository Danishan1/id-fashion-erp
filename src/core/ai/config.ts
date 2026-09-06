/**
 * AI provider configuration, read from environment variables so a model or
 * even the provider itself can change without touching application code
 * (see AI_PROVIDER/ANTHROPIC_DEFAULT_MODEL/ANTHROPIC_VISION_MODEL in
 * .env.example). Read lazily (not at module load) so a route can surface a
 * clean "configuration is missing" error instead of crashing at import time
 * when ANTHROPIC_API_KEY is unset — the common case in a fresh dev checkout.
 */

export class AiConfigMissingError extends Error {}

export interface AnthropicConfig {
  apiKey: string;
  defaultModel: string;
  visionModel: string;
}

export function getAiProvider(): string {
  return process.env.AI_PROVIDER || "none";
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

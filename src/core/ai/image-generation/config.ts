/** Mirrors src/core/ai/config.ts's AiConfigMissingError shape for the image-generation capability. */
export class ImageGenConfigMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenConfigMissingError";
  }
}

export interface OpenAiImageConfig {
  apiKey: string;
  model: string;
}

/** IMAGE_GENERATION_PROVIDER selects the provider (default "openai"); each provider's own config getter lives next to it so adding a second provider never means editing this file's OpenAI-specific logic. */
export function getOpenAiImageConfig(): OpenAiImageConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ImageGenConfigMissingError(
      "Image generation is not configured — OPENAI_API_KEY is missing. Add it to your environment to enable garment visual generation."
    );
  }
  return {
    apiKey,
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
  };
}

export interface GeminiImageConfig {
  apiKey: string;
  model: string;
}

/** A second provider, added for free/low-cost testing once the configured OpenAI account's credits were exhausted (see AI Garment Flow Process 3/4/6 notes) — Gemini's free tier is genuinely usable for functional testing, not just a trial credit. */
export function getGeminiImageConfig(): GeminiImageConfig {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ImageGenConfigMissingError(
      "Image generation is not configured — GEMINI_API_KEY is missing. Add it to your environment to enable garment visual generation."
    );
  }
  return {
    apiKey,
    // gemini-2.5-flash-image ("nano banana") is the current Gemini model with native
    // multi-image input/editing support — the one capability this provider needs for
    // generateVariation()/applyFabric(), not just plain text-to-image.
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
  };
}

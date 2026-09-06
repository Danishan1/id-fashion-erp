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

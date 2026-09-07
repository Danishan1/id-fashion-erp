import { createOpenAiImageProvider } from "./providers/openai";
import { createGeminiImageProvider } from "./providers/gemini";
import { ImageGenConfigMissingError } from "./config";
import type { ImageGenerationProvider } from "./types";

/**
 * IMAGE_GENERATION_PROVIDER selects which provider backs Process 3 — default
 * "openai". Adding a second provider (Gemini, or The New Black AI, or
 * otherwise) means writing one new file under providers/ and adding one case
 * here; nothing in visual-generation.service.ts or any route/UI file ever
 * needs to change, since they only ever talk to the ImageGenerationProvider
 * interface. Gemini was added specifically so Processes 3/4/6 can be
 * exercised live against a genuinely free tier while the configured OpenAI
 * account's credits stay exhausted — set IMAGE_GENERATION_PROVIDER=gemini
 * (and GEMINI_API_KEY) to switch, with zero other code changes.
 */
export function getImageGenerationProvider(): ImageGenerationProvider {
  const providerName = (process.env.IMAGE_GENERATION_PROVIDER || "openai").toLowerCase();

  switch (providerName) {
    case "openai":
      return createOpenAiImageProvider();
    case "gemini":
      return createGeminiImageProvider();
    default:
      throw new ImageGenConfigMissingError(
        `Unknown image generation provider "${providerName}" — set IMAGE_GENERATION_PROVIDER to a supported value ("openai", "gemini").`
      );
  }
}

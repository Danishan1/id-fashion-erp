import { createOpenAiImageProvider } from "./providers/openai";
import { ImageGenConfigMissingError } from "./config";
import type { ImageGenerationProvider } from "./types";

/**
 * IMAGE_GENERATION_PROVIDER selects which provider backs Process 3 — default
 * "openai". Adding a second provider (The New Black AI or otherwise) means
 * writing one new file under providers/ and adding one case here; nothing
 * in visual-generation.service.ts or any route/UI file ever needs to change,
 * since they only ever talk to the ImageGenerationProvider interface.
 */
export function getImageGenerationProvider(): ImageGenerationProvider {
  const providerName = (process.env.IMAGE_GENERATION_PROVIDER || "openai").toLowerCase();

  switch (providerName) {
    case "openai":
      return createOpenAiImageProvider();
    default:
      throw new ImageGenConfigMissingError(
        `Unknown image generation provider "${providerName}" — set IMAGE_GENERATION_PROVIDER to a supported value ("openai").`
      );
  }
}

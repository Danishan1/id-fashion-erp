import { createOpenAiImageProvider } from "./providers/openai";
import { createGeminiImageProvider } from "./providers/gemini";
import { createCloudflareImageProvider } from "./providers/cloudflare";
import { createQwenLocalImageProvider } from "./providers/qwen-local";
import { ImageGenConfigMissingError, getImageGenerationProviderName } from "./config";
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
 * (and GEMINI_API_KEY) to switch, with zero other code changes. Cloudflare
 * was added after Google separately restricted gemini-2.5-flash-image's own
 * free tier to 0 requests/day — text-to-image (Process 3/Regenerate) only,
 * see providers/cloudflare.ts's own comment for why Process 4/6 aren't
 * covered by it. Qwen (local) was added as a 4th option for a self-hosted
 * deployment with no hosted-API cost at all — see providers/qwen-local.ts's
 * own comment for the HTTP contract a local server must implement.
 *
 * This single env-var-selected provider remains the entry point for any
 * code that intentionally wants "whatever this deployment's one configured
 * default provider is" with no failover (kept for backward compatibility —
 * nothing here changed). The AI Provider & Failover system
 * (src/core/ai/provider-manager/AIProviderManager.ts) is the new,
 * separate, database-driven, capability-aware, multi-provider entry point
 * with automatic failover — AI Designer's own generateDesign()/editDesign()
 * now go through that instead of this function.
 */
export function getImageGenerationProvider(): ImageGenerationProvider {
  const providerName = getImageGenerationProviderName();

  switch (providerName) {
    case "openai":
      return createOpenAiImageProvider();
    case "gemini":
      return createGeminiImageProvider();
    case "cloudflare":
      return createCloudflareImageProvider();
    case "qwen-local":
      return createQwenLocalImageProvider();
    default:
      throw new ImageGenConfigMissingError(
        `Unknown image generation provider "${providerName}" — set AI_MODEL ("gpt"/"gemini") or IMAGE_GENERATION_PROVIDER to a supported value ("openai", "gemini", "cloudflare", "qwen-local").`
      );
  }
}

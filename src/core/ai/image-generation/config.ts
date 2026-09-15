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

export interface CloudflareImageConfig {
  accountId: string;
  apiToken: string;
  model: string;
  img2imgModel: string;
}

/**
 * The img2img model isn't a per-admin-row-configurable field (unlike `model`
 * itself, which the admin form sets) — it's a fixed, env-overridable
 * companion to whichever text-to-image model is configured, shared by both
 * the env-var-driven config getter below and AIProviderManager's own
 * DB-row-driven `buildProviderInstance` — one source of truth for the
 * default so the two paths can't drift onto different model strings.
 */
export function resolveCloudflareImg2ImgModel(): string {
  return process.env.CLOUDFLARE_IMG2IMG_MODEL || "@cf/runwayml/stable-diffusion-v1-5-img2img";
}

/**
 * A third provider, text-to-image only (see providers/cloudflare.ts's own
 * comment for why it can't cover Process 4/6's two-image composition needs).
 * Added because Google restricted gemini-2.5-flash-image's free tier to 0
 * requests/day some time after the Gemini provider above was written (a
 * live, external, Google-side change — confirmed via a direct API probe
 * returning "generativelanguage.googleapis.com/generate_content_free_tier_requests,
 * limit: 0" — not a bug in this codebase). Cloudflare Workers AI's free
 * allocation (10,000 "neurons"/day) has no such image-model carve-out as of
 * this writing.
 */
export function getCloudflareImageConfig(): CloudflareImageConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new ImageGenConfigMissingError(
      "Image generation is not configured — CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_API_TOKEN is missing. Add them to your environment to enable garment visual generation."
    );
  }
  return {
    accountId,
    apiToken,
    // flux-1-schnell returns a single base64 image in a plain JSON envelope —
    // easier to handle uniformly than stable-diffusion-xl's raw-binary-or-
    // JSON-error response shape, and is itself on Workers AI's free tier.
    model: process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell",
    // A genuinely free, ongoing (not trial-credit) image-to-image model on
    // the same account/token — the one real free option found that accepts
    // an actual reference image, closing the gap flux-1-schnell has (see
    // providers/cloudflare.ts's own updated header comment for the honest
    // quality tradeoff: Stable Diffusion 1.5's `strength` parameter is a
    // blunt blend control, not the smart multi-image composition
    // OpenAI/Gemini do — a deliberate, disclosed choice, not a hidden one.
    img2imgModel: resolveCloudflareImg2ImgModel(),
  };
}

export interface QwenLocalImageConfig {
  baseUrl: string;
  model: string;
  /** Self-hosted endpoints are frequently unauthenticated on a private network — genuinely optional, unlike every hosted provider's apiKey. */
  apiKey?: string;
}

/**
 * A 4th, self-hosted provider (e.g. a local Qwen-Image-Edit deployment) for
 * environments with no internet-facing AI budget at all. No specific local
 * serving tool's own API is assumed here (ComfyUI/vLLM/a custom FastAPI
 * wrapper all differ) — instead this defines one small, explicit HTTP
 * contract ("the Qwen Local Bridge", documented in full in
 * providers/qwen-local.ts) that any local server can implement. Honestly
 * unverified against a real running server in this environment — no local
 * GPU/model server was available to test against.
 */
export function getQwenLocalImageConfig(): QwenLocalImageConfig {
  const baseUrl = process.env.QWEN_LOCAL_BASE_URL;
  if (!baseUrl) {
    throw new ImageGenConfigMissingError(
      "Image generation is not configured — QWEN_LOCAL_BASE_URL is missing. Point it at a running Qwen Image Edit / local AI server to enable this provider."
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: process.env.QWEN_LOCAL_MODEL || "qwen-image-edit",
    apiKey: process.env.QWEN_LOCAL_API_KEY || undefined,
  };
}

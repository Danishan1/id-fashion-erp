import { fileTypeFromBuffer } from "file-type";
import { getCloudflareImageConfig, type CloudflareImageConfig } from "../config";
import { ImageGenerationServiceError, type GenerateImagesResult, type ImageGenerationProvider } from "../types";

/**
 * A third provider. `flux-1-schnell` (text-to-image, `generateOnce` below)
 * returns a uniform JSON envelope (`{ result: { image: "<base64>" } }`) on
 * both success and failure — the envelope's "image" field carries no
 * declared MIME type of its own, and was confirmed live to actually be JPEG
 * bytes despite nothing in Cloudflare's docs stating that, so `generateOnce`
 * sniffs the real magic bytes rather than assuming a format.
 *
 * `stable-diffusion-v1-5-img2img` (image-to-image, `postImg2Img`/
 * `generateImg2ImgSequentially` below) is the one genuinely free, ongoing
 * (not a trial credit that runs out), server-callable model found that
 * accepts a real reference image on the same account/token — it backs
 * `generateVariation`/`generateFromFabricReference`/`generateTechnicalFlat`.
 * A deliberate, disclosed quality tradeoff, not a hidden one: this is a 2022
 * Stable Diffusion 1.5 model controlled by a single `strength` blend
 * parameter (0 = keep the input almost unchanged, 1 = ignore it entirely) —
 * not the smart multi-image composition OpenAI's `images.edit()` or
 * Gemini's `generateContent` multi-Part calls do. `applyFabric` is
 * deliberately NOT implemented here — it needs two genuinely distinct
 * images (a base garment AND a swatch) faithfully composed together, and
 * this model only accepts one input image; blending only the swatch (or
 * only the base) in would silently drop the other and violate this
 * project's "never fake fabric usage" rule, so the method is simply absent
 * — callers already check for its presence and throw a clean
 * UNSUPPORTED_OPERATION error (see types.ts) rather than getting a
 * half-correct result.
 *
 * `stable-diffusion-v1-5-img2img`'s REST response shape is unconfirmed
 * against a live account in this codebase (unlike flux-1-schnell's, which
 * was) — Cloudflare's own docs describe the Workers *binding* returning a
 * `ReadableStream`, not the REST API's own envelope, and this model is in
 * the same Stable-Diffusion family flagged above as returning raw binary
 * bytes on success / JSON only on error (unlike flux-1-schnell's uniform
 * JSON envelope) — `parseImg2ImgResponse` below defensively sniffs
 * Content-Type and handles both shapes rather than assuming one.
 *
 * No official Cloudflare SDK is used — Workers AI's REST endpoint is one
 * plain POST with a bearer token, and pulling in the full `cloudflare`
 * management-API package for one inference call would be unnecessary
 * weight.
 */

const REQUEST_TIMEOUT_MS = 120_000; // image generation genuinely takes longer than a text completion

interface CloudflareAiSuccessResponse {
  success: true;
  result: { image: string };
}
interface CloudflareAiErrorResponse {
  success: false;
  errors: { code: number; message: string }[];
}

function isErrorResponse(body: unknown): body is CloudflareAiErrorResponse {
  return typeof body === "object" && body !== null && (body as { success?: unknown }).success === false;
}

/**
 * Shared HTTP-status/message → ImageGenErrorCategory classification, used by
 * both `generateOnce` (flux-1-schnell, always-JSON) and `postImg2Img`
 * (stable-diffusion-v1-5-img2img, JSON only on error) — a single place for
 * this mapping so the two call sites can never quietly drift apart.
 */
function classifyCloudflareError(status: number, message: string): ImageGenerationServiceError {
  if (status === 401 || status === 403) {
    return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "AUTH_FAILURE", message);
  }
  if (status === 429) {
    // Workers AI's free allocation (10,000 "neurons"/day) has no separate
    // "insufficient balance" status distinct from ordinary rate-limiting —
    // a daily-cap message is the only signal available to tell them apart.
    if (/daily|neuron|quota/i.test(message)) {
      return new ImageGenerationServiceError(
        "Image generation credits are exhausted for this provider. Please top up and try again.",
        "CREDITS_EXHAUSTED",
        message
      );
    }
    return new ImageGenerationServiceError("Image generation is rate-limited right now. Please try again shortly.", "RATE_LIMIT", message);
  }
  if (status === 400 && /nsfw|safety|violat|flagged/i.test(message)) {
    return new ImageGenerationServiceError(
      "The design description was flagged as unsafe or unsupported by the image provider and could not be generated.",
      "UNSAFE_CONTENT",
      message
    );
  }
  return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", message);
}

/**
 * Sniffs the real image bytes rather than trusting a declared/absent MIME
 * type — flux-1-schnell was confirmed live to actually return JPEG bytes
 * despite nothing in Cloudflare's docs stating that. The same discipline
 * this app's own upload-time content check already uses; an undetectable
 * buffer is treated as a bad response rather than guessed at.
 */
async function detectImageMimeType(buffer: Buffer): Promise<"image/png" | "image/jpeg" | "image/webp" | null> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected?.mime === "image/png" || detected?.mime === "image/jpeg" || detected?.mime === "image/webp" ? detected.mime : null;
}

async function generateOnce(config: { accountId: string; apiToken: string; model: string }, prompt: string) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ImageGenerationServiceError("Image generation timed out. Please try again.", "TIMEOUT", err);
    }
    throw new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
  } finally {
    clearTimeout(timeout);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok || isErrorResponse(body)) {
    const message = isErrorResponse(body) ? body.errors.map((e) => e.message).join("; ") : `HTTP ${res.status}`;
    return Promise.reject(classifyCloudflareError(res.status, message));
  }

  const success = body as CloudflareAiSuccessResponse;
  if (!success.result?.image) {
    throw new ImageGenerationServiceError("The image provider returned no images.", "INVALID_IMAGE_RESPONSE");
  }
  const buffer = Buffer.from(success.result.image, "base64");
  const mimeType = await detectImageMimeType(buffer);
  if (!mimeType) {
    throw new ImageGenerationServiceError("The image provider returned an unusable image.", "INVALID_IMAGE_RESPONSE");
  }
  return { image: buffer, mimeType, raw: body };
}

/**
 * The img2img model's REST response shape is unconfirmed live (see this
 * file's own header comment) — defensively handles both possibilities:
 * a JSON body (the same `{result:{image}}`/error envelope flux-1-schnell
 * uses) or raw binary image bytes with no envelope at all, distinguished by
 * the response's own Content-Type header rather than assumed either way.
 */
async function parseImg2ImgResponse(res: Response): Promise<{ image: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp"; raw: unknown }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await res.json().catch(() => null);
    if (!res.ok || isErrorResponse(body)) {
      const message = isErrorResponse(body) ? body.errors.map((e) => e.message).join("; ") : `HTTP ${res.status}`;
      throw classifyCloudflareError(res.status, message);
    }
    const success = body as CloudflareAiSuccessResponse;
    if (!success.result?.image) {
      throw new ImageGenerationServiceError("The image provider returned no images.", "INVALID_IMAGE_RESPONSE");
    }
    const buffer = Buffer.from(success.result.image, "base64");
    const mimeType = await detectImageMimeType(buffer);
    if (!mimeType) throw new ImageGenerationServiceError("The image provider returned an unusable image.", "INVALID_IMAGE_RESPONSE");
    return { image: buffer, mimeType, raw: body };
  }

  // Not JSON — Cloudflare's own error envelope is always JSON, so a non-JSON,
  // non-ok response is unexpected rather than a known error shape.
  if (!res.ok) {
    throw new ImageGenerationServiceError(`Image generation could not be completed (HTTP ${res.status}).`, "PROVIDER_ERROR");
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = await detectImageMimeType(buffer);
  if (!mimeType) throw new ImageGenerationServiceError("The image provider returned an unusable image.", "INVALID_IMAGE_RESPONSE");
  return { image: buffer, mimeType, raw: { contentType } };
}

async function postImg2Img(
  config: { accountId: string; apiToken: string; img2imgModel: string },
  prompt: string,
  inputImage: { buffer: Buffer; mimeType: string },
  strength: number
) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.img2imgModel}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        image_b64: inputImage.buffer.toString("base64"),
        strength,
        num_steps: 20,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ImageGenerationServiceError("Image generation timed out. Please try again.", "TIMEOUT", err);
    }
    throw new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
  } finally {
    clearTimeout(timeout);
  }

  return parseImg2ImgResponse(res);
}

/** Sequential, same free-tier-friendly discipline as `generate()` — a `count: 4` request doesn't burst concurrent calls against a daily-capped free allocation. */
async function generateImg2ImgSequentially(
  config: { accountId: string; apiToken: string; img2imgModel: string },
  prompt: string,
  inputImage: { buffer: Buffer; mimeType: string },
  strength: number,
  count: number
): Promise<GenerateImagesResult> {
  const images: GenerateImagesResult["images"] = [];
  const raw: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const result = await postImg2Img(config, prompt, inputImage, strength);
    images.push({ buffer: result.image, mimeType: result.mimeType });
    raw.push(result.raw);
  }
  return { images, model: config.img2imgModel, raw };
}

// Blend strength per operation — 0 keeps the input image almost unchanged,
// 1 ignores it entirely. Documented, deliberate starting points, not tuned
// against real output yet (no live test of this model exists in this
// codebase — see the file header comment):
// - A "change one named feature, preserve the rest" edit wants to stay
//   close to the original image.
// - Rendering a brand-new garment from a fabric photo (no garment exists
//   yet) or a photorealistic-to-line-art technical flat both need the
//   model to depart much further from the input's actual composition.
const IMG2IMG_STRENGTH_VARIATION = 0.5;
const IMG2IMG_STRENGTH_FABRIC_REFERENCE = 0.75;
const IMG2IMG_STRENGTH_TECHNICAL_FLAT = 0.85;

/** `config` is optional for the same backward-compatibility reason as createOpenAiImageProvider — see its own comment. */
export function createCloudflareImageProvider(config: CloudflareImageConfig = getCloudflareImageConfig()): ImageGenerationProvider {
  return {
    name: "cloudflare",
    model: config.model,

    // Requested images are generated sequentially, not via Promise.all — same
    // free-tier-friendly discipline as the Gemini provider's own
    // generateSequentially, so a `count: 4` request doesn't burst 4
    // concurrent calls against a daily-capped free allocation.
    async generate({ prompt, count }): Promise<GenerateImagesResult> {
      const images: GenerateImagesResult["images"] = [];
      const raw: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const result = await generateOnce(config, prompt);
        images.push({ buffer: result.image, mimeType: result.mimeType });
        raw.push(result.raw);
      }
      return { images, model: config.model, raw };
    },

    async generateVariation({ prompt, count, parentImage }): Promise<GenerateImagesResult> {
      return generateImg2ImgSequentially(config, prompt, parentImage, IMG2IMG_STRENGTH_VARIATION, count);
    },

    async generateFromFabricReference({ prompt, count, fabricImage }): Promise<GenerateImagesResult> {
      return generateImg2ImgSequentially(config, prompt, fabricImage, IMG2IMG_STRENGTH_FABRIC_REFERENCE, count);
    },

    async generateTechnicalFlat({ prompt, count, baseImage }): Promise<GenerateImagesResult> {
      return generateImg2ImgSequentially(config, prompt, baseImage, IMG2IMG_STRENGTH_TECHNICAL_FLAT, count);
    },

    // applyFabric deliberately omitted — see the file header comment.
  };
}

/**
 * A real, free connectivity check for the admin "Test Connection" action —
 * Workers AI's `/ai/models/search` endpoint is metadata-only (confirmed
 * live: it lists the account's available models with zero inference cost),
 * so this confirms the API token/account id are valid AND the configured
 * model genuinely exists in the account's catalog, without spending a real
 * generation credit the way calling `generate()` just to test would.
 */
async function searchCloudflareModel(config: { accountId: string; apiToken: string }, model: string): Promise<boolean> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/models/search?search=${encodeURIComponent(model)}&per_page=50`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${config.apiToken}` } });
  } catch (err) {
    throw new ImageGenerationServiceError("The Cloudflare API could not be reached. Please try again.", "PROVIDER_ERROR", err);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ImageGenerationServiceError("Cloudflare rejected the account ID or API token.", "AUTH_FAILURE");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || isErrorResponse(body)) {
    const message = isErrorResponse(body) ? body.errors.map((e) => e.message).join("; ") : `HTTP ${res.status}`;
    throw new ImageGenerationServiceError(message, "PROVIDER_ERROR", message);
  }

  const results = (body as { result?: { name?: string }[] }).result ?? [];
  return results.some((m) => m.name === model);
}

/**
 * Always checks the text-to-image model configured on the row. The img2img
 * companion model (generateVariation/generateFromFabricReference/
 * generateTechnicalFlat all depend on it) is only checked when the caller
 * actually declares one of those capabilities — a provider row scoped to
 * TEXT_TO_IMAGE only has no use for it, and checking it unconditionally
 * previously made a perfectly healthy text-to-image-only provider fail
 * "Test Connection" over a model it will never call (found live: this
 * account's flux-1-schnell model is genuinely available, but the fixed
 * img2img model wasn't, which used to fail the check for a capability this
 * row never declared).
 */
export async function testCloudflareConnection(
  config: CloudflareImageConfig,
  options?: { needsImg2Img?: boolean }
): Promise<{ modelAvailable: boolean }> {
  if (!options?.needsImg2Img) {
    return { modelAvailable: await searchCloudflareModel(config, config.model) };
  }
  const [textToImageAvailable, img2imgAvailable] = await Promise.all([
    searchCloudflareModel(config, config.model),
    searchCloudflareModel(config, config.img2imgModel),
  ]);
  return { modelAvailable: textToImageAvailable && img2imgAvailable };
}

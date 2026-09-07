import OpenAI, {
  toFile,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  BadRequestError,
} from "openai";
import type { Image as OpenAiImage } from "openai/resources/images";
import { getOpenAiImageConfig } from "../config";
import { ImageGenerationServiceError, type GenerateImagesResult, type ImageGenerationProvider } from "../types";

/**
 * The only file that imports the `openai` SDK directly — same discipline as
 * src/core/ai/providers/anthropic.ts being the sole importer of
 * @anthropic-ai/sdk. `gpt-image-1` is used deliberately over dall-e-2/3:
 * it always returns base64-encoded image data (never a URL), so there is no
 * "the OpenAI URL expired before we saved it" failure mode to guard against —
 * confirmed directly from the installed SDK's own type definitions
 * (node_modules/openai/resources/images.d.ts), not assumed from training data.
 */

const REQUEST_TIMEOUT_MS = 120_000; // image generation genuinely takes longer than a text completion
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "medium";

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
}

function mapSdkError(err: unknown): ImageGenerationServiceError {
  if (err instanceof APIConnectionTimeoutError) {
    return new ImageGenerationServiceError("Image generation timed out. Please try again.", "TIMEOUT", err);
  }
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "AUTH_FAILURE", err);
  }
  if (err instanceof RateLimitError) {
    // OpenAI reuses HTTP 429 for both "too many requests" and "insufficient_quota" (credits exhausted) —
    // confirmed live against a real exhausted-credits account: the SDK's own `type` field is
    // "insufficient_quota" and `code` is "credit_balance_exhausted" (NOT the literal string
    // "insufficient_quota" — an earlier version of this check tested the wrong field entirely).
    if (err.type === "insufficient_quota" || err.code === "credit_balance_exhausted") {
      return new ImageGenerationServiceError(
        "Image generation credits are exhausted for this provider. Please top up and try again.",
        "CREDITS_EXHAUSTED",
        err
      );
    }
    return new ImageGenerationServiceError("Image generation is rate-limited right now. Please try again shortly.", "RATE_LIMIT", err);
  }
  if (err instanceof BadRequestError) {
    const code = (err as { code?: string | null }).code ?? "";
    const type = (err as { error?: { type?: string } }).error?.type ?? "";
    if (code.includes("content_policy") || code.includes("moderation") || type.includes("moderation")) {
      return new ImageGenerationServiceError(
        "The design description was flagged as unsafe or unsupported by the image provider and could not be generated.",
        "UNSAFE_CONTENT",
        err
      );
    }
    return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
  }
  if (err instanceof APIError || err instanceof APIConnectionError) {
    return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
  }
  return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
}

function extractBuffers(images: OpenAiImage[] | undefined, count: number): GenerateImagesResult["images"] {
  if (!images || images.length === 0) {
    throw new ImageGenerationServiceError("The image provider returned no images.", "INVALID_IMAGE_RESPONSE");
  }
  const out: GenerateImagesResult["images"] = [];
  for (const img of images) {
    if (!img.b64_json) {
      throw new ImageGenerationServiceError("The image provider returned a response with no usable image data.", "INVALID_IMAGE_RESPONSE");
    }
    out.push({ buffer: Buffer.from(img.b64_json, "base64"), mimeType: "image/png" });
  }
  if (out.length !== count) {
    // Not fatal on its own (a provider may legitimately return fewer than requested under load) — but
    // never silently claim more/fewer images were generated than actually came back.
    throw new ImageGenerationServiceError(
      `Requested ${count} image(s) but the provider returned ${out.length}.`,
      "INVALID_IMAGE_RESPONSE"
    );
  }
  return out;
}

export function createOpenAiImageProvider(): ImageGenerationProvider {
  const config = getOpenAiImageConfig();
  const openai = client(config.apiKey);

  return {
    name: "openai",
    model: config.model,

    async generate({ prompt, count }): Promise<GenerateImagesResult> {
      try {
        const response = await openai.images.generate({
          model: config.model,
          prompt,
          n: count,
          size: DEFAULT_SIZE,
          quality: DEFAULT_QUALITY,
        });
        // ImagesResponse carries no `model` field of its own (confirmed from the SDK's own
        // type definitions) — the model actually used is always the one we requested.
        return { images: extractBuffers(response.data, count), model: config.model, raw: response };
      } catch (err) {
        if (err instanceof ImageGenerationServiceError) throw err;
        throw mapSdkError(err);
      }
    },

    async generateVariation({ prompt, count, parentImage }): Promise<GenerateImagesResult> {
      try {
        const file = await toFile(parentImage.buffer, "parent-image.png", { type: parentImage.mimeType });
        const response = await openai.images.edit({
          model: config.model,
          image: file,
          prompt,
          n: count,
          size: DEFAULT_SIZE,
          quality: DEFAULT_QUALITY,
        });
        return { images: extractBuffers(response.data, count), model: config.model, raw: response };
      } catch (err) {
        if (err instanceof ImageGenerationServiceError) throw err;
        throw mapSdkError(err);
      }
    },

    // gpt-image-1's edit endpoint accepts an array of up to 16 input images
    // (confirmed from the installed SDK's own type definitions,
    // node_modules/openai/resources/images.d.ts) -- passing both the base
    // garment image and the fabric swatch lets the model use the swatch as a
    // genuine second visual reference, rather than only being able to
    // describe it in the text prompt.
    async applyFabric({ prompt, count, baseImage, swatchImage }): Promise<GenerateImagesResult> {
      try {
        const baseFile = await toFile(baseImage.buffer, "base-garment.png", { type: baseImage.mimeType });
        const swatchFile = await toFile(swatchImage.buffer, "fabric-swatch.png", { type: swatchImage.mimeType });
        const response = await openai.images.edit({
          model: config.model,
          image: [baseFile, swatchFile],
          prompt,
          n: count,
          size: DEFAULT_SIZE,
          quality: DEFAULT_QUALITY,
        });
        return { images: extractBuffers(response.data, count), model: config.model, raw: response };
      } catch (err) {
        if (err instanceof ImageGenerationServiceError) throw err;
        throw mapSdkError(err);
      }
    },

    async generateTechnicalFlat({ prompt, count, baseImage }): Promise<GenerateImagesResult> {
      try {
        const file = await toFile(baseImage.buffer, "base-garment.png", { type: baseImage.mimeType });
        const response = await openai.images.edit({
          model: config.model,
          image: file,
          prompt,
          n: count,
          size: DEFAULT_SIZE,
          quality: DEFAULT_QUALITY,
        });
        return { images: extractBuffers(response.data, count), model: config.model, raw: response };
      } catch (err) {
        if (err instanceof ImageGenerationServiceError) throw err;
        throw mapSdkError(err);
      }
    },
  };
}

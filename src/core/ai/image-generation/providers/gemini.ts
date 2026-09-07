import { GoogleGenAI, ApiError, FinishReason } from "@google/genai";
import type { Content, GenerateContentResponse } from "@google/genai";
import { getGeminiImageConfig } from "../config";
import { ImageGenerationServiceError, type GenerateImagesResult, type ImageGenerationProvider } from "../types";

/**
 * The only file that imports the `@google/genai` SDK directly — same
 * discipline as src/core/ai/image-generation/providers/openai.ts being the
 * sole importer of `openai`. `gemini-2.5-flash-image` ("nano banana") is
 * used deliberately: it's the current Gemini model with native multi-image
 * input/editing via the ordinary `generateContent` call (not the separate,
 * Imagen-only `generateImages`/`editImage` methods, which don't accept two
 * arbitrary reference photos the way this provider's generateVariation/
 * applyFabric need to) — confirmed directly from the installed SDK's own
 * type definitions (node_modules/@google/genai/dist/genai.d.ts), not
 * assumed from training data. Added as a second provider so Processes 3/4/6
 * can be exercised against a genuinely free tier while the configured
 * OpenAI account's credits stay exhausted (see CLAUDE.md's own notes on
 * those processes) — select it via IMAGE_GENERATION_PROVIDER=gemini.
 */

const REQUEST_TIMEOUT_MS = 120_000; // image generation genuinely takes longer than a text completion

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
}

const SAFETY_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
]);

function mapSdkError(err: unknown): ImageGenerationServiceError {
  // The SDK's internal timeout/abort classes (RequestTimeoutError, etc.) are not exported —
  // only reachable as plain Error instances with a recognizable name/message, never as a
  // typed class this file could import. Checked before the ApiError branch since a genuine
  // network timeout never reaches the point of becoming a structured API error.
  if (err instanceof Error && (err.name === "AbortError" || /timeout|timed out|ETIMEDOUT/i.test(err.message))) {
    return new ImageGenerationServiceError("Image generation timed out. Please try again.", "TIMEOUT", err);
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "AUTH_FAILURE", err);
    }
    if (err.status === 429) {
      // Gemini's free tier reuses HTTP 429 for both "too many requests per minute" and a
      // genuinely exhausted quota — the response body's own text is the only signal
      // available to tell them apart, since (unlike OpenAI's RateLimitError) there is no
      // separate exported error subclass or machine-readable code field for this.
      if (/quota|resource_exhausted/i.test(err.message)) {
        return new ImageGenerationServiceError(
          "Image generation credits are exhausted for this provider. Please top up and try again.",
          "CREDITS_EXHAUSTED",
          err
        );
      }
      return new ImageGenerationServiceError("Image generation is rate-limited right now. Please try again shortly.", "RATE_LIMIT", err);
    }
    if (err.status === 400 && /safety|blocked/i.test(err.message)) {
      return new ImageGenerationServiceError(
        "The design description was flagged as unsafe or unsupported by the image provider and could not be generated.",
        "UNSAFE_CONTENT",
        err
      );
    }
    return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
  }
  return new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", err);
}

/** Extracts exactly one image from a single generateContent response, or throws — this provider issues one call per requested image (see generateOnce below) rather than trusting candidateCount to reliably produce N distinct images for an image-output model. */
function extractSingleImage(response: GenerateContentResponse): GenerateImagesResult["images"][number] {
  if (response.promptFeedback?.blockReason) {
    throw new ImageGenerationServiceError(
      "The design description was flagged as unsafe or unsupported by the image provider and could not be generated.",
      "UNSAFE_CONTENT"
    );
  }
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason && SAFETY_FINISH_REASONS.has(candidate.finishReason)) {
    throw new ImageGenerationServiceError(
      "The design description was flagged as unsafe or unsupported by the image provider and could not be generated.",
      "UNSAFE_CONTENT"
    );
  }
  const parts = candidate?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new ImageGenerationServiceError("The image provider returned no images.", "INVALID_IMAGE_RESPONSE");
  }
  const mimeType = imagePart.inlineData.mimeType === "image/jpeg" || imagePart.inlineData.mimeType === "image/webp"
    ? imagePart.inlineData.mimeType
    : "image/png";
  return { buffer: Buffer.from(imagePart.inlineData.data, "base64"), mimeType };
}

export function createGeminiImageProvider(): ImageGenerationProvider {
  const config = getGeminiImageConfig();
  const ai = client(config.apiKey);

  /** One generateContent call producing exactly one image. Requested images are generated sequentially, not via Promise.all — Gemini's free tier has a low requests-per-minute ceiling, and this provider exists specifically to be usable on that tier, so bursting `count` concurrent calls would defeat the point. */
  async function generateOnce(
    contents: Content[]
  ): Promise<{ image: GenerateImagesResult["images"][number]; raw: GenerateContentResponse }> {
    try {
      const response = await ai.models.generateContent({
        model: config.model,
        contents,
        config: { responseModalities: ["IMAGE"] },
      });
      return { image: extractSingleImage(response), raw: response };
    } catch (err) {
      if (err instanceof ImageGenerationServiceError) throw err;
      throw mapSdkError(err);
    }
  }

  async function generateSequentially(contents: Content[], count: number): Promise<GenerateImagesResult> {
    const images: GenerateImagesResult["images"] = [];
    const raw: GenerateContentResponse[] = [];
    for (let i = 0; i < count; i++) {
      const result = await generateOnce(contents);
      images.push(result.image);
      raw.push(result.raw);
    }
    return { images, model: config.model, raw };
  }

  return {
    name: "gemini",
    model: config.model,

    async generate({ prompt, count }): Promise<GenerateImagesResult> {
      return generateSequentially([{ role: "user", parts: [{ text: prompt }] }], count);
    },

    async generateVariation({ prompt, count, parentImage }): Promise<GenerateImagesResult> {
      return generateSequentially(
        [
          {
            role: "user",
            parts: [{ inlineData: { data: parentImage.buffer.toString("base64"), mimeType: parentImage.mimeType } }, { text: prompt }],
          },
        ],
        count
      );
    },

    // gemini-2.5-flash-image accepts an arbitrary number of inline reference images per
    // request (confirmed from the installed SDK's own type definitions — Part.inlineData
    // is a plain per-part field, and contents accepts a Part[] with no image-count cap
    // declared) — passing both the base garment image and the fabric swatch as separate
    // Parts lets the model use the swatch as a genuine second visual reference, exactly
    // matching the OpenAI provider's own two-image applyFabric() semantics.
    async applyFabric({ prompt, count, baseImage, swatchImage }): Promise<GenerateImagesResult> {
      return generateSequentially(
        [
          {
            role: "user",
            parts: [
              { inlineData: { data: baseImage.buffer.toString("base64"), mimeType: baseImage.mimeType } },
              { inlineData: { data: swatchImage.buffer.toString("base64"), mimeType: swatchImage.mimeType } },
              { text: prompt },
            ],
          },
        ],
        count
      );
    },

    async generateTechnicalFlat({ prompt, count, baseImage }): Promise<GenerateImagesResult> {
      return generateSequentially(
        [
          {
            role: "user",
            parts: [{ inlineData: { data: baseImage.buffer.toString("base64"), mimeType: baseImage.mimeType } }, { text: prompt }],
          },
        ],
        count
      );
    },
  };
}

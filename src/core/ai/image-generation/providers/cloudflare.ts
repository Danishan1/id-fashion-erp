import { fileTypeFromBuffer } from "file-type";
import { getCloudflareImageConfig } from "../config";
import { ImageGenerationServiceError, type GenerateImagesResult, type ImageGenerationProvider } from "../types";

/**
 * A third provider, text-to-image only — Cloudflare Workers AI's REST API has
 * no arbitrary-multi-image-input model comparable to Gemini's
 * gemini-2.5-flash-image or OpenAI's gpt-image-1 edit endpoint, so this
 * provider deliberately omits `generateVariation`/`applyFabric` rather than
 * faking them with a single-image call that would silently ignore the
 * parent/swatch image — callers already check for the method's presence and
 * throw a clean UNSUPPORTED_OPERATION error (see types.ts), so Process 4
 * (Controlled Design Variation) and Process 6 (Apply Actual Fabric) simply
 * aren't available while this provider is selected; only Process 3 (Generate
 * Visuals) and its "Regenerate" action are.
 *
 * No official Cloudflare SDK is used — Workers AI's REST endpoint is one
 * plain POST with a bearer token, and pulling in the full `cloudflare`
 * management-API package for one inference call would be unnecessary
 * weight. `flux-1-schnell` is used over `stable-diffusion-xl-base-1.0`
 * specifically because it returns a uniform JSON envelope
 * (`{ result: { image: "<base64>" } }`) on both success and failure — the
 * SDXL model instead returns a raw binary image body on success and JSON
 * only on error, which would need response Content-Type sniffing to handle
 * correctly. The envelope's "image" field carries no declared MIME type of
 * its own, and was confirmed live to actually be JPEG bytes despite nothing
 * in Cloudflare's docs stating that — generateOnce() below sniffs the real
 * magic bytes rather than assuming a format.
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
    if (res.status === 401 || res.status === 403) {
      return Promise.reject(new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "AUTH_FAILURE", message));
    }
    if (res.status === 429) {
      // Workers AI's free allocation (10,000 "neurons"/day) has no separate
      // "insufficient balance" status distinct from ordinary rate-limiting —
      // a daily-cap message is the only signal available to tell them apart.
      if (/daily|neuron|quota/i.test(message)) {
        return Promise.reject(
          new ImageGenerationServiceError(
            "Image generation credits are exhausted for this provider. Please top up and try again.",
            "CREDITS_EXHAUSTED",
            message
          )
        );
      }
      return Promise.reject(
        new ImageGenerationServiceError("Image generation is rate-limited right now. Please try again shortly.", "RATE_LIMIT", message)
      );
    }
    if (res.status === 400 && /nsfw|safety|violat|flagged/i.test(message)) {
      return Promise.reject(
        new ImageGenerationServiceError(
          "The design description was flagged as unsafe or unsupported by the image provider and could not be generated.",
          "UNSAFE_CONTENT",
          message
        )
      );
    }
    return Promise.reject(new ImageGenerationServiceError("Image generation could not be completed. Please try again.", "PROVIDER_ERROR", message));
  }

  const success = body as CloudflareAiSuccessResponse;
  if (!success.result?.image) {
    throw new ImageGenerationServiceError("The image provider returned no images.", "INVALID_IMAGE_RESPONSE");
  }
  const buffer = Buffer.from(success.result.image, "base64");

  // Workers AI's own response field is just called "image" with no declared
  // MIME type — flux-1-schnell was confirmed live to actually return JPEG
  // bytes (FFD8FF magic), not PNG despite what the model name/docs might
  // suggest, and this is undocumented enough to not hardcode either way.
  // Sniffing the real bytes (the same file-type package this app's own
  // upload-time magic-byte check already uses) is what caught this live: a
  // hardcoded "image/png" here made AttachmentService's own content
  // verification correctly reject every saved image with a declared/actual
  // MIME mismatch. An undetectable buffer is treated as a bad response
  // rather than guessed at, same discipline as that upload-time check.
  const detected = await fileTypeFromBuffer(buffer);
  const mimeType: "image/png" | "image/jpeg" | "image/webp" | null =
    detected?.mime === "image/png" || detected?.mime === "image/jpeg" || detected?.mime === "image/webp" ? detected.mime : null;
  if (!mimeType) {
    throw new ImageGenerationServiceError(
      `The image provider returned an unusable image (detected type: "${detected?.mime ?? "unknown"}").`,
      "INVALID_IMAGE_RESPONSE"
    );
  }
  return { image: buffer, mimeType, raw: body };
}

export function createCloudflareImageProvider(): ImageGenerationProvider {
  const config = getCloudflareImageConfig();

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
  };
}

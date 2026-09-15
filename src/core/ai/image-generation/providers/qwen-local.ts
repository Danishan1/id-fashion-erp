import { getQwenLocalImageConfig, type QwenLocalImageConfig } from "../config";
import { ImageGenerationServiceError, type GenerateImagesResult, type ImageGenerationProvider } from "../types";

/**
 * A 4th provider — a self-hosted Qwen Image Edit (or any compatible local
 * model server), for environments that want image editing/fabric-reference
 * capability with no hosted-API cost. No specific existing local-serving
 * tool's own API is assumed (ComfyUI/vLLM/text-generation-webui/a custom
 * wrapper all differ, and guessing at one unverifiable in this environment
 * would risk building against an API that does not actually exist) —
 * instead, this defines one small, explicit HTTP contract a local server
 * must implement, documented here in full:
 *
 *   POST {baseUrl}/v1/generate
 *   Headers: Content-Type: application/json; Authorization: Bearer <apiKey> (only if apiKey is configured)
 *   Body: {
 *     model: string,
 *     prompt: string,
 *     count: number,
 *     images?: { data: string (base64), mimeType: string }[]  // 0, 1, or 2 reference images
 *   }
 *   Response 200: { images: { data: string (base64), mimeType: string }[] }
 *   Response 4xx/5xx: { error: { message: string, retryable?: boolean } }
 *
 *   GET {baseUrl}/v1/health
 *   Headers: Authorization: Bearer <apiKey> (only if apiKey is configured)
 *   Response 200: { status: "ok", model: string }  -- used by the admin "Test Connection" action, a free/no-inference check.
 *
 * `retryable: true` on an error response maps to PROVIDER_UNAVAILABLE
 * (failover-eligible); anything else maps to INVALID_REQUEST (not
 * failover-eligible) — a local server has no real concept of "quota" or
 * "rate limit" the way a hosted API does, so this collapses to the two
 * categories that are actually meaningful for a self-hosted deployment.
 *
 * Honestly unverified against a real running server: no local GPU/model
 * server was available in this environment to test this against. The HTTP
 * client logic itself (timeout handling, JSON parsing, error mapping) is
 * real and exercised by unit tests with a mocked fetch; only the "does a
 * real Qwen deployment actually speak this exact contract" question is
 * unverified — see the project's own documentation for how to point this
 * at a real server and what would need adjusting if its API differs.
 */

const REQUEST_TIMEOUT_MS = 180_000; // local inference on modest hardware can be slow

interface BridgeSuccessResponse {
  images: { data: string; mimeType: string }[];
}
interface BridgeErrorResponse {
  error: { message: string; retryable?: boolean };
}

async function postToBridge(
  config: QwenLocalImageConfig,
  body: { prompt: string; count: number; images?: { data: string; mimeType: string }[] }
): Promise<GenerateImagesResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, ...body }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ImageGenerationServiceError("Image generation timed out. Please try again.", "TIMEOUT", err);
    }
    throw new ImageGenerationServiceError(
      "The local AI server could not be reached. Confirm QWEN_LOCAL_BASE_URL is correct and the server is running.",
      "PROVIDER_ERROR",
      err
    );
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await res.json().catch(() => null);

  if (!res.ok || !responseBody || "error" in responseBody) {
    const errorBody = responseBody as BridgeErrorResponse | null;
    const message = errorBody?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new ImageGenerationServiceError("The local AI server rejected the request credentials.", "AUTH_FAILURE", message);
    }
    if (errorBody?.error?.retryable || res.status >= 500) {
      throw new ImageGenerationServiceError("The local AI server is temporarily unavailable. Please try again.", "PROVIDER_ERROR", message);
    }
    throw new ImageGenerationServiceError(message, "PROVIDER_ERROR", message);
  }

  const success = responseBody as BridgeSuccessResponse;
  if (!success.images || success.images.length === 0) {
    throw new ImageGenerationServiceError("The local AI server returned no images.", "INVALID_IMAGE_RESPONSE");
  }

  const images: GenerateImagesResult["images"] = success.images.map((img) => {
    const mimeType = img.mimeType === "image/png" || img.mimeType === "image/jpeg" || img.mimeType === "image/webp" ? img.mimeType : "image/png";
    return { buffer: Buffer.from(img.data, "base64"), mimeType };
  });

  return { images, model: config.model, raw: responseBody };
}

/** `config` is optional for the same backward-compatibility reason as createOpenAiImageProvider — see its own comment. */
export function createQwenLocalImageProvider(config: QwenLocalImageConfig = getQwenLocalImageConfig()): ImageGenerationProvider {
  return {
    name: "qwen-local",
    model: config.model,

    async generate({ prompt, count }): Promise<GenerateImagesResult> {
      return postToBridge(config, { prompt, count });
    },

    async generateVariation({ prompt, count, parentImage }): Promise<GenerateImagesResult> {
      return postToBridge(config, {
        prompt,
        count,
        images: [{ data: parentImage.buffer.toString("base64"), mimeType: parentImage.mimeType }],
      });
    },

    async applyFabric({ prompt, count, baseImage, swatchImage }): Promise<GenerateImagesResult> {
      return postToBridge(config, {
        prompt,
        count,
        images: [
          { data: baseImage.buffer.toString("base64"), mimeType: baseImage.mimeType },
          { data: swatchImage.buffer.toString("base64"), mimeType: swatchImage.mimeType },
        ],
      });
    },

    async generateTechnicalFlat({ prompt, count, baseImage }): Promise<GenerateImagesResult> {
      return postToBridge(config, {
        prompt,
        count,
        images: [{ data: baseImage.buffer.toString("base64"), mimeType: baseImage.mimeType }],
      });
    },

    async generateFromFabricReference({ prompt, count, fabricImage }): Promise<GenerateImagesResult> {
      return postToBridge(config, {
        prompt,
        count,
        images: [{ data: fabricImage.buffer.toString("base64"), mimeType: fabricImage.mimeType }],
      });
    },
  };
}

/** A real, free connectivity check for the admin "Test Connection" action — GET /v1/health, no inference cost. See this file's own header comment for the full Bridge contract. */
export async function testQwenLocalConnection(config: QwenLocalImageConfig): Promise<{ modelAvailable: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/v1/health`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
  } catch (err) {
    throw new ImageGenerationServiceError(
      "The local AI server could not be reached. Confirm QWEN_LOCAL_BASE_URL is correct and the server is running.",
      "PROVIDER_ERROR",
      err
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ImageGenerationServiceError("The local AI server rejected the request credentials.", "AUTH_FAILURE");
  }
  if (!res.ok) {
    throw new ImageGenerationServiceError(`The local AI server returned HTTP ${res.status}.`, "PROVIDER_ERROR");
  }
  const body = await res.json().catch(() => null);
  const reportedModel = (body as { model?: string } | null)?.model;
  return { modelAvailable: !reportedModel || reportedModel === config.model };
}

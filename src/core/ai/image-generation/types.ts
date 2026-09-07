/**
 * Provider-agnostic contract for garment visual generation (AI Garment Flow
 * Process 3). No file in this module or its callers imports a specific
 * vendor's SDK directly except src/core/ai/image-generation/providers/* —
 * swapping in a second provider (The New Black AI or otherwise) later means
 * adding one new file under providers/ and one line in factory.ts, nothing
 * else in this codebase changes.
 */

export interface GeneratedImageFile {
  /** Raw image bytes — saved through the existing AttachmentService/FileStorage, never kept as an external URL (an OpenAI url expires in ~60 minutes; a local file never does). */
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface GenerateImagesResult {
  images: GeneratedImageFile[];
  model: string;
  raw: unknown;
}

export type ImageGenErrorCategory =
  | "MISSING_CONFIG"
  | "TIMEOUT"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "CREDITS_EXHAUSTED"
  | "UNSAFE_CONTENT"
  | "UNSUPPORTED_OPERATION"
  | "PROVIDER_ERROR"
  | "INVALID_IMAGE_RESPONSE";

/** A provider-level failure — the caller maps this to a clean, generic user-facing message, never a raw SDK error. */
export class ImageGenerationServiceError extends Error {
  constructor(
    message: string,
    public readonly category: ImageGenErrorCategory,
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ImageGenerationServiceError";
  }
}

export interface ImageGenerationProvider {
  readonly name: string;
  readonly model: string;

  /** Generates `count` fresh images from a text prompt alone — used by both the initial "Generate Visual" batch and "Regenerate". */
  generate(params: { prompt: string; count: number }): Promise<GenerateImagesResult>;

  /**
   * Generates `count` image-to-image variations of an existing image — used by "Create Variation".
   * Optional: a provider with no image-to-image capability simply omits this method; callers check
   * for its presence and throw a clean UNSUPPORTED_OPERATION error rather than assuming every provider has it.
   */
  generateVariation?(params: {
    prompt: string;
    count: number;
    parentImage: { buffer: Buffer; mimeType: string };
  }): Promise<GenerateImagesResult>;

  /**
   * Applies a fabric swatch image onto an existing garment image (AI Garment
   * Flow Process 6) — a genuine two-image composition, distinct from
   * `generateVariation`'s single-image edit. Optional, same
   * check-before-use/UNSUPPORTED_OPERATION discipline as `generateVariation`
   * — a provider with no multi-image editing capability simply omits this
   * method rather than approximating it with a single-image call that would
   * silently ignore the swatch.
   */
  applyFabric?(params: {
    prompt: string;
    count: number;
    baseImage: { buffer: Buffer; mimeType: string };
    swatchImage: { buffer: Buffer; mimeType: string };
  }): Promise<GenerateImagesResult>;

  /**
   * Regenerates an existing garment image as a technical flat / CAD-style
   * line drawing (AI Garment Flow Process 7) — the same single-base-image
   * shape as `generateVariation`, but named distinctly since the
   * transformation is a different kind (photorealistic-to-technical-line-art,
   * not "change one named feature") — never reuse `generateVariation` for
   * this, to avoid conflating two semantically different operations that
   * happen to share a parameter shape. Optional, same
   * check-before-use/UNSUPPORTED_OPERATION discipline as the other optional
   * capabilities above.
   */
  generateTechnicalFlat?(params: {
    prompt: string;
    count: number;
    baseImage: { buffer: Buffer; mimeType: string };
  }): Promise<GenerateImagesResult>;
}

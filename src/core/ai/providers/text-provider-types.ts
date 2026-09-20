/**
 * Provider-neutral types/error classes shared by every structured text/vision
 * AI backend (`anthropic.ts`, `openai-text.ts`, and any future one). Kept in
 * its own file with zero SDK imports so the two provider files can import
 * each other's *types* without a runtime circular dependency — `anthropic.ts`
 * calls into `openai-text.ts` (to delegate when AI_TEXT_PROVIDER=openai) and
 * `openai-text.ts` needs the same `AiServiceError`/`AiInvalidResponseError`
 * classes `anthropic.ts` already exports (so every caller's existing
 * `instanceof AiServiceError` check keeps working no matter which backend
 * actually ran) — routing both through this neutral file avoids the two
 * provider files ever importing one another directly.
 */

export type AiErrorCategory =
  | "MISSING_CONFIG"
  | "TIMEOUT"
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "PROVIDER_ERROR"
  | "NO_STRUCTURED_RESPONSE"
  | "INVALID_STRUCTURED_RESPONSE";

/** A provider-level failure — the caller maps this to a clean, generic user-facing message, never a raw SDK error. */
export class AiServiceError extends Error {
  constructor(
    message: string,
    public readonly category: AiErrorCategory,
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "AiServiceError";
  }
}

/** The model returned no usable structured output, even after one corrective retry. */
export class AiInvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInvalidResponseError";
  }
}

export interface StructuredToolCallResult<T> {
  data: T;
  model: string;
  rawResponse: unknown;
}

export interface ToolSchema<T> {
  toolName: string;
  toolDescription: string;
  /** A JSON-Schema `{type:"object", properties, required}` object — built by the caller from its own Zod schema's shape. */
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  /** Re-validates the raw structured output against the caller's own Zod schema — the real gate before anything is persisted, regardless of which provider ran. */
  validate: (input: unknown) => { success: true; data: T } | { success: false; error: string };
}

export interface RequestStructuredVisionOutputParams<T> extends ToolSchema<T> {
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  systemPrompt: string;
  userText: string;
}

export interface RequestStructuredTextOutputParams<T> extends ToolSchema<T> {
  systemPrompt: string;
  userText: string;
}

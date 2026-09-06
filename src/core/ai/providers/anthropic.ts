import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicConfig } from "@/core/ai/config";

/**
 * Low-level, provider-specific wrapper around the Anthropic SDK — the only
 * file in this codebase that imports `@anthropic-ai/sdk` directly. A future
 * ImageGenerationProvider or a second text/vision provider gets its own
 * sibling file here; nothing above this layer (reference-analysis/,
 * development-brief/, or any future AI Garment Flow process) imports the
 * SDK itself, so switching providers later means adding a new file here,
 * not rewriting callers.
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

/**
 * 90s was too short for a real workload, confirmed live: generating a batch
 * of fully-detailed design directions (up to TEXT_MAX_OUTPUT_TOKENS, 16000)
 * genuinely took longer than that and surfaced as a raw
 * APIConnectionTimeoutError. 180s gives real, larger structured generations
 * room to finish without masking an actually-hung request forever.
 */
const REQUEST_TIMEOUT_MS = 180_000;

function anthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
}

function mapSdkError(err: unknown): AiServiceError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT", err);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "AUTH_FAILURE", err);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "RATE_LIMIT", err);
  }
  if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "PROVIDER_ERROR", err);
  }
  return new AiServiceError("AI analysis could not be completed. Please try again.", "PROVIDER_ERROR", err);
}

/** Keywords Anthropic's `strict: true` tool mode rejects outright, confirmed live against the real API — never silently ignored, a 400 either way. */
const UNSUPPORTED_STRICT_SCHEMA_KEYWORDS = new Set(["minItems", "maxItems", "minimum", "maximum"]);

/**
 * Anthropic's `strict: true` tool mode (1) requires every `object`-type
 * JSON-Schema node — including nested ones — to explicitly declare
 * `additionalProperties: false`, and (2) rejects a fixed set of ordinary
 * JSON-Schema bound keywords outright rather than ignoring them — both
 * confirmed live against the real API:
 *   - `tools.0.custom: For 'object' type, 'additionalProperties' must be explicitly set to false`
 *   - `tools.0.custom: For 'array' type, property 'maxItems' is not supported`
 *   - `tools.0.custom: For 'integer' type, properties maximum, minimum are not supported`
 * Applied once here, generically, so every caller's schema builder
 * (reference-analysis/, development-brief/, and any future one) never has to
 * remember this on every node itself — an omitted bound (count, min/max
 * score) is instead enforced by the caller's own Zod `validate()`, which
 * already triggers the existing one-shot corrective retry on a mismatch.
 */
function sanitizeForStrictToolSchema(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sanitizeForStrictToolSchema);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const obj = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (UNSUPPORTED_STRICT_SCHEMA_KEYWORDS.has(key)) continue;
    result[key] = sanitizeForStrictToolSchema(value);
  }
  if (result.type === "object" && result.additionalProperties === undefined) {
    result.additionalProperties = false;
  }
  return result;
}

export interface StructuredToolCallResult<T> {
  data: T;
  model: string;
  rawResponse: unknown;
}

interface ToolSchema<T> {
  toolName: string;
  toolDescription: string;
  /** A JSON-Schema `{type:"object", properties, required}` object — built by the caller from its own Zod schema's shape. */
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  /** Re-validates the tool's raw `input` against the caller's own Zod schema — `strict: true` on the tool constrains the model server-side, but this is the actual gate before anything is persisted. */
  validate: (input: unknown) => { success: true; data: T } | { success: false; error: string };
}

/**
 * Shared core: calls Anthropic forcing a single structured tool call (never
 * free text) via `tool_choice` + `strict: true`, validates the result, and
 * retries exactly once with a corrective follow-up on a validation failure.
 * Never returns a fabricated/partial result — a failure always throws
 * AiServiceError or AiInvalidResponseError. Model, content blocks, and
 * max_tokens are supplied by the vision/text wrappers below so this one
 * function backs both.
 */
async function requestStructuredToolCall<T>(params: {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  content: Anthropic.ContentBlockParam[];
  appendCorrectiveText: (content: Anthropic.ContentBlockParam[], instruction: string) => Anthropic.ContentBlockParam[];
  tool: ToolSchema<T>;
  /**
   * `strict: true` forces Anthropic's constrained-decoding grammar compiler
   * to guarantee schema-valid output, but that compiler has a real size
   * limit — confirmed live: Process 1's 36-nested-feature reference-analysis
   * schema is rejected outright with a 400 "The compiled grammar is too
   * large... Simplify your tool schemas or reduce the number of strict
   * tools," which no amount of Zod-side validation can work around, since
   * the request itself never succeeds. Defaults to true (Process 2's
   * smaller, flatter schema compiles fine); a caller with an oversized
   * schema passes `false` instead — the existing Zod `validate()` +
   * one-shot corrective retry is still the real safety net either way, just
   * no longer backed by a server-side grammar guarantee for that call.
   */
  strict?: boolean;
}): Promise<StructuredToolCallResult<T>> {
  const config = getAnthropicConfig();
  const client = anthropicClient(config.apiKey);
  const strict = params.strict ?? true;

  async function attempt(content: Anthropic.ContentBlockParam[]) {
    let response;
    try {
      response = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.systemPrompt,
        messages: [{ role: "user", content }],
        tools: [
          {
            name: params.tool.toolName,
            description: params.tool.toolDescription,
            input_schema: (strict
              ? sanitizeForStrictToolSchema(params.tool.inputSchema)
              : params.tool.inputSchema) as Anthropic.Tool.InputSchema,
            strict,
          },
        ],
        tool_choice: { type: "tool", name: params.tool.toolName },
      });
    } catch (err) {
      if (process.env.AI_DEBUG === "1") {
        console.error("[AI_DEBUG] raw SDK error:", err);
      }
      throw mapSdkError(err);
    }

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) return { input: undefined, model: response.model, raw: response };
    return { input: toolUse.input, model: response.model, raw: response };
  }

  let result = await attempt(params.content);
  let validated =
    result.input === undefined
      ? ({ success: false, error: "The model did not return a structured tool response." } as const)
      : params.tool.validate(result.input);

  if (process.env.AI_DEBUG === "1" && !validated.success) {
    console.error("[AI_DEBUG] first attempt validation error:", validated.error);
    console.error("[AI_DEBUG] first attempt raw tool input:", JSON.stringify(result.input));
  }

  if (!validated.success) {
    const correctiveContent = params.appendCorrectiveText(
      params.content,
      `Your previous response was invalid: ${validated.error}. Return ONLY a single tool call matching the exact required schema — every field is required, and enum fields must use one of the exact allowed values given.`
    );
    result = await attempt(correctiveContent);
    validated =
      result.input === undefined
        ? ({ success: false, error: "The model did not return a structured tool response." } as const)
        : params.tool.validate(result.input);

    if (process.env.AI_DEBUG === "1" && !validated.success) {
      console.error("[AI_DEBUG] corrective attempt validation error:", validated.error);
      console.error("[AI_DEBUG] corrective attempt raw tool input:", JSON.stringify(result.input));
    }
  }

  if (!validated.success) {
    throw new AiInvalidResponseError("AI returned an invalid structured response.");
  }

  return { data: validated.data, model: result.model, rawResponse: result.raw };
}

function appendTextToLastTextBlock(content: Anthropic.ContentBlockParam[], instruction: string): Anthropic.ContentBlockParam[] {
  const next = [...content];
  const lastTextIdx = next.map((b) => b.type).lastIndexOf("text");
  if (lastTextIdx === -1) {
    next.push({ type: "text", text: instruction });
  } else {
    const block = next[lastTextIdx] as Anthropic.TextBlockParam;
    next[lastTextIdx] = { ...block, text: `${block.text}\n\n${instruction}` };
  }
  return next;
}

interface RequestStructuredVisionOutputParams<T> extends ToolSchema<T> {
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  systemPrompt: string;
  userText: string;
}

/**
 * 8000 was too short for a real workload, confirmed live: a genuine
 * 36-field vision analysis with rich per-field prose was truncated
 * mid-schema (the model never reached the final couple of required
 * fields), which is exactly what caused the AI_INVALID_RESPONSE failure
 * that first surfaced this whole issue. 16000 matches Process 2's own
 * proven-safe bound for a comparably large structured response.
 */
const VISION_MAX_OUTPUT_TOKENS = 16000;

/**
 * Uses ANTHROPIC_VISION_MODEL — the strongest available model, for garment
 * image analysis (Process 1). `strict: false` — confirmed live, twice, even
 * AFTER flattening reference-analysis/schema.ts's nested groups
 * (sleeve/fabricObservations/printPattern/constructionComplexity → flat
 * top-level keys): the request still gets rejected with the same 400 "The
 * compiled grammar is too large... Simplify your tool schemas or reduce the
 * number of strict tools." This schema's total size — 36 separate
 * observation objects, each with its own enum + two string fields — is what
 * exceeds Anthropic's strict-mode grammar-compiler limit, not the nesting
 * depth; flattening changed the JSON shape but not the total node count, so
 * it did not fix the rejection. `strict: false` is therefore the only viable
 * option for this specific schema today (Process 2's development-brief
 * schema is smaller and keeps `strict: true`) — the existing Zod
 * `validate()` + one-shot corrective retry is the real safety net for shape
 * correctness in its place, and the earlier flattening work still pays off
 * here: the previously-observed wrong-shape failure ("sleeve: expected
 * object, received string") was specifically about a *nested* sub-object,
 * which no longer exists in this flat schema.
 */
export async function requestStructuredVisionOutput<T>(
  params: RequestStructuredVisionOutputParams<T>
): Promise<StructuredToolCallResult<T>> {
  const config = getAnthropicConfig();
  return requestStructuredToolCall<T>({
    model: config.visionModel,
    maxTokens: VISION_MAX_OUTPUT_TOKENS,
    systemPrompt: params.systemPrompt,
    content: [
      { type: "image", source: { type: "base64", media_type: params.imageMediaType, data: params.imageBase64 } },
      { type: "text", text: params.userText },
    ],
    appendCorrectiveText: appendTextToLastTextBlock,
    tool: { toolName: params.toolName, toolDescription: params.toolDescription, inputSchema: params.inputSchema, validate: params.validate },
    strict: false,
  });
}

interface RequestStructuredTextOutputParams<T> extends ToolSchema<T> {
  systemPrompt: string;
  userText: string;
}

const TEXT_MAX_OUTPUT_TOKENS = 16000;

/** Uses ANTHROPIC_DEFAULT_MODEL (Sonnet) — normal/simple text-processing tasks with no image involved (Process 2 onward). */
export async function requestStructuredTextOutput<T>(
  params: RequestStructuredTextOutputParams<T>
): Promise<StructuredToolCallResult<T>> {
  const config = getAnthropicConfig();
  return requestStructuredToolCall<T>({
    model: config.defaultModel,
    maxTokens: TEXT_MAX_OUTPUT_TOKENS,
    systemPrompt: params.systemPrompt,
    content: [{ type: "text", text: params.userText }],
    appendCorrectiveText: appendTextToLastTextBlock,
    tool: { toolName: params.toolName, toolDescription: params.toolDescription, inputSchema: params.inputSchema, validate: params.validate },
  });
}

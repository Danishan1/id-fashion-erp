import OpenAI, {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getOpenAiTextConfig } from "@/core/ai/config";
import {
  AiServiceError,
  AiInvalidResponseError,
  type RequestStructuredVisionOutputParams,
  type RequestStructuredTextOutputParams,
  type StructuredToolCallResult,
} from "./text-provider-types";

/**
 * OpenAI backend for the same structured text/vision contract
 * `anthropic.ts` exposes — the only file that imports the `openai` SDK for
 * this purpose (image generation has its own separate sibling file under
 * `core/ai/image-generation/providers/openai.ts`). `anthropic.ts` delegates
 * here when `AI_TEXT_PROVIDER=openai`; every caller (Fabric Analysis,
 * Reference Analysis, Development Brief, ...) is unaware which backend
 * actually ran, since both return the identical `StructuredToolCallResult<T>`
 * shape and throw the identical `AiServiceError`/`AiInvalidResponseError`
 * classes.
 *
 * Uses OpenAI's Structured Outputs (`response_format: {type:"json_schema"}`)
 * with `strict: false` rather than `strict: true` — deliberately, not an
 * oversight: OpenAI's strict mode requires every `properties` key to also be
 * listed in `required` (no optional fields at all), a constraint several of
 * this codebase's ~17 existing tool schemas were never designed against
 * (they were built for Anthropic's own, differently-shaped `strict: true`
 * rules). Auditing and reshaping every schema to satisfy that would be a much
 * larger, separate change. `strict: false` still requests JSON in the given
 * shape; the caller's own Zod `validate()` + the one-shot corrective retry
 * below remain the real correctness gate either way — the exact same
 * "strict:false + Zod is the real safety net" tradeoff this codebase already
 * made for Anthropic's own largest (36-field) schema.
 */

const REQUEST_TIMEOUT_MS = 180_000;

function client(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
}

/**
 * Some OpenAI models, when asked for `json_schema`-shaped output with
 * `strict: false`, occasionally echo the *schema envelope itself*
 * (`{type:"object", properties:{...actual answer...}}`) instead of just the
 * flat answer object — confirmed live against a real request (Replicate
 * Design's Compatibility Check): the model's real, well-formed answer
 * (`items`/`overallSummary`/`overallRating`/`overallSuggestion`) came back
 * nested one level under a `properties` key, with a sibling `type: "object"`
 * key mirroring the schema's own shape, on both the original attempt AND the
 * one-shot corrective retry — so without this unwrap, this failure mode is
 * not self-correcting and always exhausts the retry before throwing
 * `AiInvalidResponseError`. Only unwraps when the top-level object is
 * missing every one of the schema's real top-level keys AND `.properties`
 * itself contains at least one of them — never touches a genuinely valid
 * response that happens to have its own field literally named "properties".
 */
export function unwrapSchemaEchoIfPresent(parsed: unknown, expectedKeys: string[]): unknown {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const parsedObj = parsed as Record<string, unknown>;
  const properties = parsedObj.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return parsed;
  const propertiesObj = properties as Record<string, unknown>;

  const hasAnyExpectedTopLevel = expectedKeys.some((key) => key in parsedObj);
  const propertiesHasExpectedKeys = expectedKeys.some((key) => key in propertiesObj);
  if (!hasAnyExpectedTopLevel && propertiesHasExpectedKeys) {
    return propertiesObj;
  }
  return parsed;
}

function mapSdkError(err: unknown): AiServiceError {
  if (err instanceof APIConnectionTimeoutError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT", err);
  }
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "AUTH_FAILURE", err);
  }
  if (err instanceof RateLimitError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "RATE_LIMIT", err);
  }
  if (err instanceof APIError || err instanceof APIConnectionError) {
    return new AiServiceError("AI analysis could not be completed. Please try again.", "PROVIDER_ERROR", err);
  }
  return new AiServiceError("AI analysis could not be completed. Please try again.", "PROVIDER_ERROR", err);
}

interface CallParams<T> {
  apiKey: string;
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userContent: ChatCompletionContentPart[];
  toolName: string;
  toolDescription: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  validate: (input: unknown) => { success: true; data: T } | { success: false; error: string };
}

async function requestStructuredJson<T>(params: CallParams<T>): Promise<StructuredToolCallResult<T>> {
  const openai = client(params.apiKey);

  const baseMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: params.userContent },
  ];

  const responseFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: params.toolName,
      description: params.toolDescription,
      schema: params.inputSchema,
      strict: false,
    },
  };

  async function attempt(messages: ChatCompletionMessageParam[]) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: params.model,
        max_completion_tokens: params.maxTokens,
        messages,
        response_format: responseFormat,
      });
    } catch (err) {
      if (process.env.AI_DEBUG === "1") {
        console.error("[AI_DEBUG] raw OpenAI SDK error:", err);
      }
      throw mapSdkError(err);
    }
    const content = response.choices[0]?.message?.content ?? null;
    if (!content) return { input: undefined, model: response.model, raw: response };
    try {
      const parsed = JSON.parse(content) as unknown;
      const expectedKeys = Object.keys(params.inputSchema.properties);
      return { input: unwrapSchemaEchoIfPresent(parsed, expectedKeys), model: response.model, raw: response };
    } catch {
      return { input: undefined, model: response.model, raw: response };
    }
  }

  let result = await attempt(baseMessages);
  let validated =
    result.input === undefined
      ? ({ success: false, error: "The model did not return a structured JSON response." } as const)
      : params.validate(result.input);

  if (process.env.AI_DEBUG === "1" && !validated.success) {
    console.error("[AI_DEBUG] first attempt validation error:", validated.error);
    console.error("[AI_DEBUG] first attempt raw content:", JSON.stringify(result.input));
  }

  if (!validated.success) {
    const correctiveMessages: ChatCompletionMessageParam[] = [
      ...baseMessages,
      { role: "assistant", content: JSON.stringify(result.input ?? {}) },
      {
        role: "user",
        content: `Your previous response was invalid: ${validated.error}. Return ONLY a single JSON object matching the exact required schema — every field is required, and enum fields must use one of the exact allowed values given.`,
      },
    ];
    result = await attempt(correctiveMessages);
    validated =
      result.input === undefined
        ? ({ success: false, error: "The model did not return a structured JSON response." } as const)
        : params.validate(result.input);

    if (process.env.AI_DEBUG === "1" && !validated.success) {
      console.error("[AI_DEBUG] corrective attempt validation error:", validated.error);
      console.error("[AI_DEBUG] corrective attempt raw content:", JSON.stringify(result.input));
    }
  }

  if (!validated.success) {
    throw new AiInvalidResponseError("AI returned an invalid structured response.");
  }

  return { data: validated.data, model: result.model, rawResponse: result.raw };
}

const VISION_MAX_OUTPUT_TOKENS = 16000;

export async function requestStructuredVisionOutputViaOpenAi<T>(
  params: RequestStructuredVisionOutputParams<T>
): Promise<StructuredToolCallResult<T>> {
  const config = getOpenAiTextConfig();
  return requestStructuredJson<T>({
    apiKey: config.apiKey,
    model: config.visionModel,
    maxTokens: VISION_MAX_OUTPUT_TOKENS,
    systemPrompt: params.systemPrompt,
    userContent: [
      { type: "text", text: params.userText },
      { type: "image_url", image_url: { url: `data:${params.imageMediaType};base64,${params.imageBase64}` } },
    ],
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    inputSchema: params.inputSchema,
    validate: params.validate,
  });
}

const TEXT_MAX_OUTPUT_TOKENS = 16000;

export async function requestStructuredTextOutputViaOpenAi<T>(
  params: RequestStructuredTextOutputParams<T>
): Promise<StructuredToolCallResult<T>> {
  const config = getOpenAiTextConfig();
  return requestStructuredJson<T>({
    apiKey: config.apiKey,
    model: config.defaultModel,
    maxTokens: TEXT_MAX_OUTPUT_TOKENS,
    systemPrompt: params.systemPrompt,
    userContent: [{ type: "text", text: params.userText }],
    toolName: params.toolName,
    toolDescription: params.toolDescription,
    inputSchema: params.inputSchema,
    validate: params.validate,
  });
}

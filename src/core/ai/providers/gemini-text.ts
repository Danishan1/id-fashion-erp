import { GoogleGenAI, ApiError } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { getGeminiTextConfig } from "@/core/ai/config";
import { unwrapSchemaEchoIfPresent } from "./openai-text";
import {
  AiServiceError,
  AiInvalidResponseError,
  type RequestStructuredVisionOutputParams,
  type RequestStructuredTextOutputParams,
  type StructuredToolCallResult,
} from "./text-provider-types";

/**
 * Gemini backend for the same structured text/vision contract `anthropic.ts`
 * exposes — selected via AI_TEXT_PROVIDER=gemini. `anthropic.ts` delegates
 * here exactly like it does to `openai-text.ts`; every caller is unaware
 * which backend ran (same `StructuredToolCallResult<T>`, same error classes).
 *
 * Uses Gemini's JSON mode (`responseMimeType: "application/json"` +
 * `responseJsonSchema`). `responseJsonSchema` accepts ordinary JSON Schema
 * (unlike the older OpenAPI-subset `responseSchema`), so the existing tool
 * schemas built for Anthropic/OpenAI pass through unchanged. The caller's own
 * Zod `validate()` + one corrective retry remain the real correctness gate,
 * same as the other two backends.
 */

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 16000;
const GENERIC_MESSAGE = "AI analysis could not be completed. Please try again.";

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
}

function mapSdkError(err: unknown): AiServiceError {
  if (err instanceof Error && (err.name === "AbortError" || /timeout|timed out|ETIMEDOUT/i.test(err.message))) {
    return new AiServiceError(GENERIC_MESSAGE, "TIMEOUT", err);
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return new AiServiceError(GENERIC_MESSAGE, "AUTH_FAILURE", err);
    if (err.status === 429) return new AiServiceError(GENERIC_MESSAGE, "RATE_LIMIT", err);
    if (err.status === 400 && /api key/i.test(err.message)) return new AiServiceError(GENERIC_MESSAGE, "AUTH_FAILURE", err);
  }
  return new AiServiceError(GENERIC_MESSAGE, "PROVIDER_ERROR", err);
}

interface CallParams<T> {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userParts: Part[];
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  validate: (input: unknown) => { success: true; data: T } | { success: false; error: string };
}

async function requestStructuredJson<T>(params: CallParams<T>): Promise<StructuredToolCallResult<T>> {
  const ai = client(params.apiKey);
  const baseContents: Content[] = [{ role: "user", parts: params.userParts }];
  const expectedKeys = Object.keys(params.inputSchema.properties);

  async function attempt(contents: Content[]) {
    let response;
    try {
      response = await ai.models.generateContent({
        model: params.model,
        contents,
        config: {
          systemInstruction: params.systemPrompt,
          responseMimeType: "application/json",
          responseJsonSchema: params.inputSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch (err) {
      if (process.env.AI_DEBUG === "1") console.error("[AI_DEBUG] raw Gemini SDK error:", err);
      throw mapSdkError(err);
    }
    const text = response.text ?? "";
    const model = response.modelVersion ?? params.model;
    if (!text) return { input: undefined, rawText: text, model, raw: response };
    try {
      const parsed = JSON.parse(text) as unknown;
      return { input: unwrapSchemaEchoIfPresent(parsed, expectedKeys), rawText: text, model, raw: response };
    } catch {
      return { input: undefined, rawText: text, model, raw: response };
    }
  }

  const check = (input: unknown) =>
    input === undefined
      ? ({ success: false, error: "The model did not return a structured JSON response." } as const)
      : params.validate(input);

  let result = await attempt(baseContents);
  let validated = check(result.input);

  if (!validated.success) {
    if (process.env.AI_DEBUG === "1") {
      console.error("[AI_DEBUG] first attempt validation error:", validated.error);
      console.error("[AI_DEBUG] first attempt raw content:", result.rawText.slice(0, 2000));
    }
    const corrective: Content[] = [
      ...baseContents,
      { role: "model", parts: [{ text: result.rawText || "{}" }] },
      {
        role: "user",
        parts: [
          {
            text: `Your previous response was invalid: ${validated.error}. Return ONLY a single JSON object matching the exact required schema — every required field must be present, and enum fields must use one of the exact allowed values given.`,
          },
        ],
      },
    ];
    result = await attempt(corrective);
    validated = check(result.input);
    if (process.env.AI_DEBUG === "1" && !validated.success) {
      console.error("[AI_DEBUG] corrective attempt validation error:", validated.error);
    }
  }

  if (!validated.success) {
    throw new AiInvalidResponseError("AI returned an invalid structured response.");
  }
  return { data: validated.data, model: result.model, rawResponse: result.raw };
}

export async function requestStructuredVisionOutputViaGemini<T>(
  params: RequestStructuredVisionOutputParams<T>
): Promise<StructuredToolCallResult<T>> {
  const config = getGeminiTextConfig();
  return requestStructuredJson<T>({
    apiKey: config.apiKey,
    model: config.visionModel,
    systemPrompt: params.systemPrompt,
    userParts: [
      { text: params.userText },
      { inlineData: { mimeType: params.imageMediaType, data: params.imageBase64 } },
    ],
    inputSchema: params.inputSchema,
    validate: params.validate,
  });
}

export async function requestStructuredTextOutputViaGemini<T>(
  params: RequestStructuredTextOutputParams<T>
): Promise<StructuredToolCallResult<T>> {
  const config = getGeminiTextConfig();
  return requestStructuredJson<T>({
    apiKey: config.apiKey,
    model: config.defaultModel,
    systemPrompt: params.systemPrompt,
    userParts: [{ text: params.userText }],
    inputSchema: params.inputSchema,
    validate: params.validate,
  });
}

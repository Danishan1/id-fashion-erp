import { GoogleGenAI, ApiError } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { getGeminiTextConfig } from "@/core/ai/config";
import {
  AiServiceError,
  AiInvalidResponseError,
  type RequestStructuredVisionOutputParams,
  type RequestStructuredTextOutputParams,
  type StructuredToolCallResult,
} from "./text-provider-types";
import { unwrapSchemaEchoIfPresent } from "./openai-text";

/**
 * Gemini backend for the same structured text/vision contract `anthropic.ts`
 * exposes. `anthropic.ts` delegates here when `AI_TEXT_PROVIDER=gemini`;
 * callers never know which backend ran, since all three return the same
 * `StructuredToolCallResult<T>` and throw the same error classes.
 *
 * Asks for JSON via `responseMimeType` + `responseJsonSchema`. If Gemini
 * rejects a schema keyword (a 400 that names the schema), the request is
 * retried once without the schema, with the schema written into the prompt
 * instead. Either way the caller's own Zod `validate()` plus one corrective
 * retry are the real correctness gate, exactly as in `openai-text.ts`.
 */

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 16000;

function mapSdkError(err: unknown): AiServiceError {
  const generic = "AI analysis could not be completed. Please try again.";
  if (err instanceof ApiError) {
    if (err.status === 429) {
      if (/quota|resource_exhausted/i.test(err.message)) {
        return new AiServiceError(
          "AI analysis is unavailable: the Gemini API quota is used up. Wait for it to reset or add billing in Google AI Studio, then try again.",
          "RATE_LIMIT",
          err
        );
      }
      return new AiServiceError(generic, "RATE_LIMIT", err);
    }
    if (err.status === 401 || err.status === 403) {
      return new AiServiceError("AI analysis could not be completed: the Gemini API key was rejected.", "AUTH_FAILURE", err);
    }
    if (isTemporaryOverload(err)) {
      return new AiServiceError("Gemini is overloaded right now. Please try again in a minute.", "PROVIDER_ERROR", err);
    }
    return new AiServiceError(generic, "PROVIDER_ERROR", err);
  }
  if (err instanceof Error && /timeout|timed out|aborted/i.test(`${err.name} ${err.message}`)) {
    return new AiServiceError(generic, "TIMEOUT", err);
  }
  return new AiServiceError(generic, "PROVIDER_ERROR", err);
}

/** Gemini (especially the free tier) often answers 503 "high demand"; that is temporary, so retry with backoff. */
const OVERLOAD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

function isTemporaryOverload(err: unknown): boolean {
  return err instanceof ApiError && [500, 502, 503, 504].includes(err.status);
}

async function withOverloadRetry<R>(run: () => Promise<R>): Promise<R> {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (!isTemporaryOverload(err) || i >= OVERLOAD_RETRY_DELAYS_MS.length) throw err;
      if (process.env.AI_DEBUG === "1") console.error(`[AI_DEBUG] Gemini overloaded, retry ${i + 1} in ${OVERLOAD_RETRY_DELAYS_MS[i]}ms`);
      await new Promise((resolve) => setTimeout(resolve, OVERLOAD_RETRY_DELAYS_MS[i]));
    }
  }
}

function isSchemaRejection(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /schema/i.test(err.message);
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
  const ai = new GoogleGenAI({ apiKey: params.apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
  const expectedKeys = Object.keys(params.inputSchema.properties);
  let useSchema = true;

  async function attempt(contents: Content[]) {
    const run = () =>
      withOverloadRetry(() => ai.models.generateContent({
        model: params.model,
        contents,
        config: {
          systemInstruction: useSchema
            ? params.systemPrompt
            : `${params.systemPrompt}\n\nReturn ONLY a single JSON object matching this JSON Schema:\n${JSON.stringify(params.inputSchema)}`,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          ...(useSchema ? { responseJsonSchema: params.inputSchema } : {}),
        },
      }));

    let response;
    try {
      response = await run();
    } catch (err) {
      if (useSchema && isSchemaRejection(err)) {
        useSchema = false;
        try {
          response = await run();
        } catch (retryErr) {
          if (process.env.AI_DEBUG === "1") console.error("[AI_DEBUG] raw Gemini SDK error:", retryErr);
          throw mapSdkError(retryErr);
        }
      } else {
        if (process.env.AI_DEBUG === "1") console.error("[AI_DEBUG] raw Gemini SDK error:", err);
        throw mapSdkError(err);
      }
    }

    const text = response.text;
    const model = response.modelVersion ?? params.model;
    if (!text) return { input: undefined, text: "", model, raw: response };
    try {
      return { input: unwrapSchemaEchoIfPresent(JSON.parse(text) as unknown, expectedKeys), text, model, raw: response };
    } catch {
      return { input: undefined, text, model, raw: response };
    }
  }

  const baseContents: Content[] = [{ role: "user", parts: params.userParts }];
  let result = await attempt(baseContents);
  let validated =
    result.input === undefined
      ? ({ success: false, error: "The model did not return a structured JSON response." } as const)
      : params.validate(result.input);

  if (!validated.success) {
    if (process.env.AI_DEBUG === "1") console.error("[AI_DEBUG] first attempt validation error:", validated.error);
    result = await attempt([
      ...baseContents,
      { role: "model", parts: [{ text: result.text || "{}" }] },
      {
        role: "user",
        parts: [
          {
            text: `Your previous response was invalid: ${validated.error}. Return ONLY a single JSON object matching the exact required schema — every field is required, and enum fields must use one of the exact allowed values given.`,
          },
        ],
      },
    ]);
    validated =
      result.input === undefined
        ? ({ success: false, error: "The model did not return a structured JSON response." } as const)
        : params.validate(result.input);
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
    userParts: [{ text: params.userText }, { inlineData: { mimeType: params.imageMediaType, data: params.imageBase64 } }],
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

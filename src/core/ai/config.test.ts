import { afterEach, describe, expect, it } from "vitest";
import { getAiModelSetting, getAiTextProvider } from "./config";

const saved = { AI_MODEL: process.env.AI_MODEL, AI_TEXT_PROVIDER: process.env.AI_TEXT_PROVIDER };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("AI_MODEL", () => {
  it.each([
    ["gpt", "openai"],
    ["GEMINI", "gemini"],
    ["anthropic", "anthropic"],
  ])("AI_MODEL=%s selects the %s text provider, overriding AI_TEXT_PROVIDER", (value, expected) => {
    process.env.AI_MODEL = value;
    process.env.AI_TEXT_PROVIDER = "openai";
    if (expected === "openai") process.env.AI_TEXT_PROVIDER = "anthropic";
    expect(getAiTextProvider()).toBe(expected);
  });

  it("falls back to AI_TEXT_PROVIDER when AI_MODEL is unset", () => {
    delete process.env.AI_MODEL;
    process.env.AI_TEXT_PROVIDER = "gemini";
    expect(getAiTextProvider()).toBe("gemini");
  });

  it("rejects an unknown AI_MODEL value", () => {
    process.env.AI_MODEL = "llama";
    expect(() => getAiModelSetting()).toThrow(/not supported/);
  });
});

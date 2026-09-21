import { describe, expect, it } from "vitest";
import { unwrapSchemaEchoIfPresent } from "./openai-text";

describe("unwrapSchemaEchoIfPresent", () => {
  it("unwraps the real, live-reproduced schema-echo shape (Compatibility Check)", () => {
    // Exact shape captured via AI_DEBUG=1 against a real OpenAI request: the model's
    // genuine answer was nested one level under `properties`, alongside a sibling
    // `type: "object"` key mirroring the schema's own envelope.
    const echoed = {
      type: "object",
      properties: {
        items: [{ subjectNumber: 1, rating: "MINOR_CONCERN", reasoning: "...", suggestion: "..." }],
        overallSummary: "...",
        overallRating: "MINOR_CONCERN",
        overallSuggestion: "...",
      },
    };
    const result = unwrapSchemaEchoIfPresent(echoed, ["items", "overallSummary", "overallRating", "overallSuggestion"]);
    expect(result).toEqual(echoed.properties);
  });

  it("leaves a genuinely valid flat response completely untouched", () => {
    const valid = { items: [], overallSummary: "x", overallRating: "COMPATIBLE", overallSuggestion: "y" };
    expect(unwrapSchemaEchoIfPresent(valid, ["items", "overallSummary", "overallRating", "overallSuggestion"])).toBe(valid);
  });

  it("does not unwrap when the top level already has at least one expected key (avoids masking a genuinely different malformed shape)", () => {
    const partiallyValid = { overallSummary: "x", properties: { items: [] } };
    const result = unwrapSchemaEchoIfPresent(partiallyValid, ["items", "overallSummary"]);
    expect(result).toBe(partiallyValid);
  });

  it("does not unwrap when .properties exists but contains none of the expected keys", () => {
    const unrelated = { properties: { somethingElse: 1 } };
    const result = unwrapSchemaEchoIfPresent(unrelated, ["items", "overallSummary"]);
    expect(result).toBe(unrelated);
  });

  it("leaves a response whose real field is legitimately named 'properties' untouched, as long as an expected top-level key is also present", () => {
    // A real field literally named "properties" (e.g. a garment's material properties list)
    // must never be mistaken for the schema-echo wrapper.
    const legit = { overallSummary: "x", properties: "cotton, breathable" };
    const result = unwrapSchemaEchoIfPresent(legit, ["overallSummary", "properties"]);
    expect(result).toBe(legit);
  });

  it("handles non-object input gracefully (null, array, primitive)", () => {
    expect(unwrapSchemaEchoIfPresent(null, ["items"])).toBe(null);
    expect(unwrapSchemaEchoIfPresent([1, 2, 3], ["items"])).toEqual([1, 2, 3]);
    expect(unwrapSchemaEchoIfPresent("plain string", ["items"])).toBe("plain string");
    expect(unwrapSchemaEchoIfPresent(42, ["items"])).toBe(42);
  });

  it("handles a top-level object with no properties key at all", () => {
    const noProps = { items: [], overallSummary: "x" };
    expect(unwrapSchemaEchoIfPresent(noProps, ["items", "overallSummary"])).toBe(noProps);
  });

  it("does not unwrap when .properties is itself an array or primitive", () => {
    expect(unwrapSchemaEchoIfPresent({ properties: [1, 2] }, ["items"])).toEqual({ properties: [1, 2] });
    expect(unwrapSchemaEchoIfPresent({ properties: "x" }, ["items"])).toEqual({ properties: "x" });
  });
});

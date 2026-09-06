import Anthropic from "@anthropic-ai/sdk";

function withAdditionalPropertiesFalse(node) {
  if (Array.isArray(node)) return node.map(withAdditionalPropertiesFalse);
  if (node === null || typeof node !== "object") return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) result[key] = withAdditionalPropertiesFalse(value);
  if (result.type === "object" && result.additionalProperties === undefined) result.additionalProperties = false;
  return result;
}

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5";
const client = new Anthropic({ apiKey, timeout: 60000, maxRetries: 0 });

const rawSchema = {
  type: "object",
  properties: {
    designDirections: {
      type: "array",
      minItems: 1, items: {
        type: "object",
        properties: {
          name: { type: "string" },
          scores: {
            type: "object",
            properties: { a: { type: "integer" } },
            required: ["a"],
          },
        },
        required: ["name", "scores"],
      },
      minItems: 1,
      
    },
  },
  required: ["designDirections"],
};

const inputSchema = withAdditionalPropertiesFalse(rawSchema);

try {
  const res = await client.messages.create({
    model,
    max_tokens: 500,
    system: "Generate 1 design direction.",
    messages: [{ role: "user", content: "go" }],
    tools: [{ name: "submit", description: "submit", input_schema: inputSchema, strict: true }],
    tool_choice: { type: "tool", name: "submit" },
  });
  console.log("SUCCESS:", JSON.stringify(res.content));
} catch (err) {
  console.log("ERROR:", err?.message);
}

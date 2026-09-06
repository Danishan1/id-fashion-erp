import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5";
console.log("model:", model, "key present:", !!apiKey, "key length:", apiKey ? apiKey.length : 0);

const client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 0 });

try {
  const res = await client.messages.create({
    model,
    max_tokens: 100,
    messages: [{ role: "user", content: "Say OK." }],
  });
  console.log("SUCCESS:", JSON.stringify(res.content));
} catch (err) {
  console.log("ERROR name:", err?.constructor?.name);
  console.log("ERROR status:", err?.status);
  console.log("ERROR message:", err?.message);
  console.log("ERROR full:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
}

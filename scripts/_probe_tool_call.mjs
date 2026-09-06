import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5";
const client = new Anthropic({ apiKey, timeout: 60000, maxRetries: 0 });

function stringField() {
  return { type: "string" };
}
function ratingField() {
  return { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] };
}

function designDirectionNode() {
  return {
    type: "object",
    properties: {
      designDirectionName: stringField(),
      commercialClassification: { type: "string", enum: ["SAFE_COMMERCIAL", "BALANCED", "FASHION_FORWARD"] },
      targetConsumer: stringField(),
      silhouette: stringField(),
      garmentLength: stringField(),
      fit: stringField(),
      neckline: stringField(),
      collar: stringField(),
      sleeve: stringField(),
      shoulderConstruction: stringField(),
      frontConstruction: stringField(),
      backConstruction: stringField(),
      closure: stringField(),
      pocket: stringField(),
      waistTreatment: stringField(),
      hem: stringField(),
      keyNewDesignFeature: stringField(),
      suggestedFabricCharacter: stringField(),
      suggestedTrims: stringField(),
      productionComplexity: ratingField(),
      expectedFabricConsumption: ratingField(),
      targetPriceCompatibilityLevel: ratingField(),
      commercialRationale: stringField(),
      manufacturingRisk: stringField(),
      differentiationFromReference: stringField(),
      scores: {
        type: "object",
        properties: {
          commercialPotential: { type: "integer", minimum: 0, maximum: 10 },
          buyerFit: { type: "integer", minimum: 0, maximum: 10 },
          manufacturingEase: { type: "integer", minimum: 0, maximum: 10 },
          targetPriceCompatibility: { type: "integer", minimum: 0, maximum: 10 },
          fabricEfficiency: { type: "integer", minimum: 0, maximum: 10 },
          designFreshness: { type: "integer", minimum: 0, maximum: 10 },
        },
        required: ["commercialPotential", "buyerFit", "manufacturingEase", "targetPriceCompatibility", "fabricEfficiency", "designFreshness"],
      },
      overallScore: { type: "integer", minimum: 0, maximum: 100 },
    },
    required: [
      "designDirectionName", "commercialClassification", "targetConsumer", "silhouette", "garmentLength", "fit",
      "neckline", "collar", "sleeve", "shoulderConstruction", "frontConstruction", "backConstruction", "closure",
      "pocket", "waistTreatment", "hem", "keyNewDesignFeature", "suggestedFabricCharacter", "suggestedTrims",
      "productionComplexity", "expectedFabricConsumption", "targetPriceCompatibilityLevel", "commercialRationale",
      "manufacturingRisk", "differentiationFromReference", "scores", "overallScore",
    ],
  };
}

const inputSchema = {
  type: "object",
  properties: {
    designDirections: {
      type: "array",
      items: designDirectionNode(),
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ["designDirections"],
};

try {
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    system: "You are a garment design director. Generate exactly 3 design directions for a basic cotton shirt.",
    messages: [{ role: "user", content: "Generate 3 design directions." }],
    tools: [
      {
        name: "submit_design_directions",
        description: "Submit the design directions",
        input_schema: inputSchema,
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: "submit_design_directions" },
  });
  console.log("SUCCESS, stop_reason:", res.stop_reason);
  console.log(JSON.stringify(res.content).slice(0, 500));
} catch (err) {
  console.log("ERROR name:", err?.constructor?.name);
  console.log("ERROR status:", err?.status);
  console.log("ERROR message:", err?.message);
  console.log("ERROR error field:", JSON.stringify(err?.error));
}

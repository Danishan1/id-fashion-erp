import "dotenv/config";
import { generateDevelopmentBrief } from "@/core/ai/development-brief/generate";
import type { DevelopmentBriefContext } from "@/core/ai/development-brief/prompt";

const ctx: DevelopmentBriefContext = {
  targetMarket: "USA",
  targetCustomerProfile: "Young professionals, 25-35",
  season: undefined,
  category: undefined,
  targetSellingPrice: 45,
  currencyCode: "USD",
  preferredFabric: "lightweight cotton poplin",
  factoryCapabilities: "basic wovens, no embroidery",
  buyer: undefined,
  directionCount: 3,
  designBalance: "BALANCED",
  referenceAnalysis: {
    designDnaSummary: "A relaxed, boxy woven shirt with a dropped shoulder and clean minimal front.",
    keyDesignLanguageFeatures: ["Relaxed boxy silhouette", "Dropped shoulder"],
    featuresForFurtherDevelopment: ["Collar treatment", "Hem finish"],
    featuresToChangeForDifferentiation: ["Placket width", "Pocket placement"],
    constructionComplexityLevel: "MEDIUM",
  },
} as unknown as DevelopmentBriefContext;

try {
  const result = await generateDevelopmentBrief(ctx);
  console.log("SUCCESS", result.directions.length);
} catch (err) {
  console.log("name:", (err as Error).name);
  console.log("message:", (err as Error).message);
  const cause = (err as Error).cause;
  console.log("cause name:", (cause as Error)?.constructor?.name);
  console.log("cause message:", (cause as Error)?.message);
}

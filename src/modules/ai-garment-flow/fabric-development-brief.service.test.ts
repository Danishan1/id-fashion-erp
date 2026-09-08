import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/fabric-development-brief/generate", () => ({
  generateFabricDevelopmentBrief: vi.fn(),
  regenerateFabricDesignDirection: vi.fn(),
  PROMPT_VERSION: "fabric-development-brief-v1",
  AiConfigMissingError: class AiConfigMissingError extends Error {},
  AiServiceError: class AiServiceError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.category = category;
    }
  },
  AiInvalidResponseError: class AiInvalidResponseError extends Error {},
}));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("./fabric-analysis.repository", () => ({
  AiGarmentFabricAnalysisRepository: { findByProjectId: vi.fn() },
}));
vi.mock("./product-suitability.repository", () => ({
  AiGarmentProductSuitabilityRepository: { findByProjectId: vi.fn() },
}));
vi.mock("@/modules/garment-attributes/garment-attributes.repository", () => ({
  GarmentAttributeRepository: { season: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: {
    createMany: vi.fn(),
    recomputeRecommendations: vi.fn(),
    findByProjectId: vi.fn(),
  },
}));
vi.mock("./fabric-development-brief.repository", () => ({
  AiGarmentFabricDevelopmentRunRepository: {
    create: vi.fn(),
    findActiveSince: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findById: vi.fn(),
  },
}));

const { generateFabricDevelopmentBrief, AiConfigMissingError, AiServiceError } = await import(
  "@/core/ai/fabric-development-brief/generate"
);
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentFabricAnalysisRepository } = await import("./fabric-analysis.repository");
const { AiGarmentProductSuitabilityRepository } = await import("./product-suitability.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { AiGarmentFabricDevelopmentRunRepository } = await import("./fabric-development-brief.repository");
const { buildFabricContext, createFabricDevelopmentBrief, buildFabricContextForRegenerate } = await import(
  "./fabric-development-brief.service"
);

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  customerId: null,
  buyerId: null,
  season: null,
  buyer: null,
  targetMarket: "USA",
  targetCustomerProfile: null,
  targetSellingPrice: null,
  currencyCode: null,
};

const approvedFabricAnalysis = {
  id: "fa-1",
  status: "APPROVED",
  fabricSummary: "180 GSM combed cotton single jersey.",
  observations: [{ featureKey: "gsm", approvedObservation: "180" }],
};

const approvedSuitability = (items = [{ approvedRating: "HIGHLY_SUITABLE", productType: { name: "T-Shirt" }, aiReasoning: "Ideal knit weight." }]) => ({
  id: "ps-1",
  status: "APPROVED",
  items,
});

const fakeDirection = {
  designDirectionName: "Direction 1",
  commercialClassification: "BALANCED" as const,
  targetConsumer: "Young professionals",
  silhouette: "Boxy",
  garmentLength: "Regular",
  fit: "Relaxed",
  neckline: "Round",
  collar: "None",
  sleeve: "Short",
  shoulderConstruction: "Set-in",
  frontConstruction: "Plain",
  backConstruction: "Plain",
  closure: "Pullover",
  pocket: "None",
  waistTreatment: "Straight hem",
  hem: "Straight",
  keyNewDesignFeature: "Dropped shoulder",
  suggestedFabricCharacter: "Behaves as a soft, mid-weight cotton jersey with moderate stretch.",
  suggestedTrims: "None",
  productionComplexity: "LOW" as const,
  expectedFabricConsumption: "MEDIUM" as const,
  targetPriceCompatibilityLevel: "HIGH" as const,
  commercialRationale: "Broad appeal.",
  manufacturingRisk: "Low risk.",
  differentiationFromReference: "Different neckline and hem versus the other directions in this batch.",
  scores: {
    commercialPotential: 8,
    buyerFit: 7,
    manufacturingEase: 9,
    targetPriceCompatibility: 8,
    fabricEfficiency: 7,
    designFreshness: 6,
  },
  overallScore: 75,
};

beforeEach(() => {
  vi.mocked(generateFabricDevelopmentBrief).mockReset();
  vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockReset().mockResolvedValue(baseProject as never);
  vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockReset().mockResolvedValue(approvedFabricAnalysis as never);
  vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockReset().mockResolvedValue(approvedSuitability() as never);
  vi.mocked(AiGarmentFabricDevelopmentRunRepository.create).mockReset().mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(AiGarmentFabricDevelopmentRunRepository.findActiveSince).mockReset().mockResolvedValue(null);
  vi.mocked(AiGarmentFabricDevelopmentRunRepository.markSuccess).mockReset();
  vi.mocked(AiGarmentFabricDevelopmentRunRepository.markFailed).mockReset();
  vi.mocked(AiGarmentFabricDevelopmentRunRepository.findById).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.createMany).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.recomputeRecommendations).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.findByProjectId).mockReset().mockResolvedValue([] as never);
});

describe("buildFabricContext", () => {
  it("blocks when the Fabric Analysis is not approved", async () => {
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue({ id: "fa-1", status: "AI_ANALYSED" } as never);

    await expect(
      buildFabricContext("co-1", "proj-1", { directionCount: 6, designBalance: "BALANCED" })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("blocks when the Product Suitability assessment is not approved", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue({ id: "ps-1", status: "UNDER_REVIEW" } as never);

    await expect(
      buildFabricContext("co-1", "proj-1", { directionCount: 6, designBalance: "BALANCED" })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("blocks when zero garment types are rated HIGHLY_SUITABLE or SUITABLE", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue(
      approvedSuitability([{ approvedRating: "NOT_SUITABLE", productType: { name: "Jacket" }, aiReasoning: "Too heavy a fabric." }]) as never
    );

    await expect(
      buildFabricContext("co-1", "proj-1", { directionCount: 6, designBalance: "BALANCED" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("filters to only HIGHLY_SUITABLE/SUITABLE garment types in the built context", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue(
      approvedSuitability([
        { approvedRating: "HIGHLY_SUITABLE", productType: { name: "T-Shirt" }, aiReasoning: "Great knit weight." },
        { approvedRating: "SUITABLE", productType: { name: "Tank Top" }, aiReasoning: "Workable." },
        { approvedRating: "NOT_SUITABLE", productType: { name: "Jacket" }, aiReasoning: "Too heavy." },
      ]) as never
    );

    const { context } = await buildFabricContext("co-1", "proj-1", { directionCount: 6, designBalance: "BALANCED" });

    expect(context.suitableProductTypes).toEqual([
      { name: "T-Shirt", rating: "HIGHLY_SUITABLE", reasoning: "Great knit weight." },
      { name: "Tank Top", rating: "SUITABLE", reasoning: "Workable." },
    ]);
  });
});

describe("createFabricDevelopmentBrief", () => {
  it("blocks a duplicate request while a run is already in progress", async () => {
    vi.mocked(AiGarmentFabricDevelopmentRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(
      createFabricDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentFabricDevelopmentRunRepository.create).not.toHaveBeenCalled();
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    vi.mocked(generateFabricDevelopmentBrief).mockRejectedValue(new AiConfigMissingError("AI service configuration is missing."));

    await expect(
      createFabricDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" })
    ).rejects.toMatchObject({ code: "AI_SERVICE_ERROR", message: "AI service configuration is missing." });
    expect(AiGarmentFabricDevelopmentRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "MISSING_CONFIG",
      "AI service configuration is missing."
    );
    expect(AiGarmentDesignDirectionRepository.createMany).not.toHaveBeenCalled();
  });

  it("maps a real AI service failure to AI_SERVICE_ERROR without persisting a partial/fabricated result", async () => {
    vi.mocked(generateFabricDevelopmentBrief).mockRejectedValue(new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT"));

    await expect(
      createFabricDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" })
    ).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentFabricDevelopmentRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
    expect(AiGarmentDesignDirectionRepository.createMany).not.toHaveBeenCalled();
  });

  it("persists exactly N directions tagged with fabricDevelopmentRunId (never developmentBriefRunId) and recomputes recommendations on success", async () => {
    vi.mocked(generateFabricDevelopmentBrief).mockResolvedValue({
      directions: [fakeDirection, { ...fakeDirection, designDirectionName: "Direction 2", overallScore: 60 }],
      model: "claude-sonnet-5",
      rawResponse: {},
    } as never);

    await createFabricDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" });

    expect(AiGarmentDesignDirectionRepository.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          designDirectionName: "Direction 1",
          overallScore: 75,
          fabricDevelopmentRunId: "run-1",
        }),
        expect.objectContaining({ designDirectionName: "Direction 2", overallScore: 60, fabricDevelopmentRunId: "run-1" }),
      ])
    );
    const rows = vi.mocked(AiGarmentDesignDirectionRepository.createMany).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.developmentBriefRunId === undefined)).toBe(true);
    expect(AiGarmentDesignDirectionRepository.recomputeRecommendations).toHaveBeenCalledWith("proj-1");
    expect(AiGarmentFabricDevelopmentRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("buildFabricContextForRegenerate", () => {
  it("throws NOT_FOUND when the originating run no longer exists", async () => {
    vi.mocked(AiGarmentFabricDevelopmentRunRepository.findById).mockResolvedValue(null);

    await expect(buildFabricContextForRegenerate("co-1", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rebuilds context for exactly 1 direction using the run's own designBalance and snapshot", async () => {
    vi.mocked(AiGarmentFabricDevelopmentRunRepository.findById).mockResolvedValue({
      id: "run-1",
      projectId: "proj-1",
      designBalance: "FASHION_FORWARD",
      contextSnapshotJson: { targetMarket: "Europe", buyer: "Zenith" },
    } as never);

    const { context } = await buildFabricContextForRegenerate("co-1", "run-1");

    expect(context.directionCount).toBe(1);
    expect(context.designBalance).toBe("FASHION_FORWARD");
  });
});

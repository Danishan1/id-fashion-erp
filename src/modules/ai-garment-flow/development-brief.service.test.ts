import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/development-brief/generate", () => ({
  generateDevelopmentBrief: vi.fn(),
  regenerateDesignDirection: vi.fn(),
  PROMPT_VERSION: "development-brief-v1",
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
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("./reference-analysis.repository", () => ({
  AiGarmentReferenceAnalysisRepository: { findByProjectId: vi.fn() },
}));
vi.mock("@/modules/garment-attributes/garment-attributes.repository", () => ({
  GarmentAttributeRepository: { season: { findFirst: vi.fn() }, category: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: {
    findByProjectId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    recomputeRecommendations: vi.fn(),
    countByStatus: vi.fn(),
  },
  AiGarmentDevelopmentBriefRunRepository: {
    create: vi.fn(),
    findActiveSince: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findById: vi.fn(),
  },
}));

const { generateDevelopmentBrief, regenerateDesignDirection: aiRegenerate, AiConfigMissingError, AiServiceError } = await import(
  "@/core/ai/development-brief/generate"
);
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentReferenceAnalysisRepository } = await import("./reference-analysis.repository");
const { AiGarmentDesignDirectionRepository, AiGarmentDevelopmentBriefRunRepository } = await import("./development-brief.repository");
const {
  createDevelopmentBrief,
  editDesignDirection,
  decideDesignDirection,
  regenerateDesignDirection,
} = await import("./development-brief.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  customerId: null,
  buyerId: null,
  season: null,
  category: null,
  buyer: null,
  targetMarket: "USA",
  targetCustomerProfile: null,
  targetSellingPrice: null,
  currencyCode: null,
};

const approvedAnalysis = {
  id: "analysis-1",
  status: "APPROVED",
  observations: [{ featureKey: "garmentCategory", approvedObservation: "Shirt" }, { featureKey: "silhouette", approvedObservation: "Boxy" }],
  designDnaSummary: "Clean minimal shirt.",
  keyDesignLanguageFeatures: ["Clean lines"],
  featuresForFurtherDevelopment: ["Collar"],
  featuresToChangeForDifferentiation: ["Placket"],
  constructionComplexityLevel: "MEDIUM",
};

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
  suggestedFabricCharacter: "Mid-weight cotton",
  suggestedTrims: "None",
  productionComplexity: "LOW" as const,
  expectedFabricConsumption: "MEDIUM" as const,
  targetPriceCompatibilityLevel: "HIGH" as const,
  commercialRationale: "Broad appeal.",
  manufacturingRisk: "Low risk.",
  differentiationFromReference: "Different neckline and hem.",
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
  vi.mocked(generateDevelopmentBrief).mockReset();
  vi.mocked(aiRegenerate).mockReset();
  vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockReset().mockResolvedValue(baseProject as never);
  vi.mocked(AiGarmentProjectRepository.findAnyById).mockReset().mockResolvedValue(baseProject as never);
  vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockReset().mockResolvedValue(approvedAnalysis as never);
  vi.mocked(AiGarmentDevelopmentBriefRunRepository.create).mockReset().mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(AiGarmentDevelopmentBriefRunRepository.findActiveSince).mockReset().mockResolvedValue(null);
  vi.mocked(AiGarmentDevelopmentBriefRunRepository.markSuccess).mockReset();
  vi.mocked(AiGarmentDevelopmentBriefRunRepository.markFailed).mockReset();
  vi.mocked(AiGarmentDevelopmentBriefRunRepository.findById).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.createMany).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.recomputeRecommendations).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.findByProjectId).mockReset().mockResolvedValue([] as never);
  vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockReset();
  vi.mocked(AiGarmentDesignDirectionRepository.update).mockReset();
});

describe("createDevelopmentBrief", () => {
  it("blocks generation before the Reference Analysis is approved", async () => {
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "AI_ANALYSED" } as never);

    await expect(
      createDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" } as never)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(generateDevelopmentBrief).not.toHaveBeenCalled();
  });

  it("blocks a duplicate request while a run is already in progress", async () => {
    vi.mocked(AiGarmentDevelopmentBriefRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(
      createDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" } as never)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentDevelopmentBriefRunRepository.create).not.toHaveBeenCalled();
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    vi.mocked(generateDevelopmentBrief).mockRejectedValue(new AiConfigMissingError("AI service configuration is missing."));

    await expect(
      createDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" } as never)
    ).rejects.toMatchObject({ code: "AI_SERVICE_ERROR", message: "AI service configuration is missing." });
    expect(AiGarmentDevelopmentBriefRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", "AI service configuration is missing.");
    expect(AiGarmentDesignDirectionRepository.createMany).not.toHaveBeenCalled();
  });

  it("persists exactly N directions and recomputes recommendations on success", async () => {
    vi.mocked(generateDevelopmentBrief).mockResolvedValue({
      directions: [fakeDirection, { ...fakeDirection, designDirectionName: "Direction 2", overallScore: 60 }],
      model: "claude-sonnet-5",
      rawResponse: {},
    } as never);

    await createDevelopmentBrief(actor, "proj-1", { directionCount: 6, designBalance: "BALANCED" } as never);

    expect(AiGarmentDesignDirectionRepository.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ designDirectionName: "Direction 1", overallScore: 75, commercialPotentialScore: 8 }),
        expect.objectContaining({ designDirectionName: "Direction 2", overallScore: 60 }),
      ])
    );
    expect(AiGarmentDesignDirectionRepository.recomputeRecommendations).toHaveBeenCalledWith("proj-1");
    expect(AiGarmentDevelopmentBriefRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("editDesignDirection", () => {
  const owned = (overrides = {}) => ({
    id: "dir-1",
    projectId: "proj-1",
    status: "APPROVED",
    userNotes: null,
    project: { companyId: "co-1" },
    ...overrides,
  });

  it("rejects a direction belonging to another company", async () => {
    vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockResolvedValue({
      ...owned(),
      project: { companyId: "other-co" },
    } as never);

    await expect(editDesignDirection(actor, "dir-1", { silhouette: "New" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(AiGarmentDesignDirectionRepository.update).not.toHaveBeenCalled();
  });

  it("reverts an APPROVED direction back to GENERATED when a content field is edited", async () => {
    vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockResolvedValue(owned() as never);

    await editDesignDirection(actor, "dir-1", { silhouette: "Updated silhouette" });

    expect(AiGarmentDesignDirectionRepository.update).toHaveBeenCalledWith(
      "dir-1",
      expect.objectContaining({ silhouette: "Updated silhouette", userEdited: true, status: "GENERATED" })
    );
    expect(AiGarmentDesignDirectionRepository.recomputeRecommendations).toHaveBeenCalledWith("proj-1");
  });

  it("editing only userNotes does not revert status or force userEdited", async () => {
    vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockResolvedValue(owned() as never);

    await editDesignDirection(actor, "dir-1", { userNotes: "Just a note" });

    const callArg = vi.mocked(AiGarmentDesignDirectionRepository.update).mock.calls[0][1];
    expect(callArg).not.toHaveProperty("status");
    expect(callArg).not.toHaveProperty("userEdited");
    expect(AiGarmentDesignDirectionRepository.recomputeRecommendations).not.toHaveBeenCalled();
  });
});

describe("decideDesignDirection", () => {
  it("recomputes recommendations after every decision, including reject", async () => {
    vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockResolvedValue({
      id: "dir-1",
      projectId: "proj-1",
      status: "GENERATED",
      project: { companyId: "co-1" },
    } as never);

    await decideDesignDirection(actor, "dir-1", { decision: "REJECT" });

    expect(AiGarmentDesignDirectionRepository.update).toHaveBeenCalledWith("dir-1", { status: "REJECTED" });
    expect(AiGarmentDesignDirectionRepository.recomputeRecommendations).toHaveBeenCalledWith("proj-1");
  });
});

describe("regenerateDesignDirection", () => {
  it("bumps version, resets status/userEdited, and keeps existing user notes", async () => {
    vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockResolvedValue({
      id: "dir-1",
      projectId: "proj-1",
      developmentBriefRunId: "run-1",
      version: 1,
      userNotes: "Keep this note",
      status: "APPROVED",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(AiGarmentDevelopmentBriefRunRepository.findById).mockResolvedValue({
      id: "run-1",
      designBalance: "BALANCED",
      contextSnapshotJson: {},
    } as never);
    vi.mocked(aiRegenerate).mockResolvedValue({ direction: fakeDirection, model: "claude-sonnet-5", rawResponse: {} } as never);

    await regenerateDesignDirection(actor, "dir-1");

    expect(AiGarmentDesignDirectionRepository.update).toHaveBeenCalledWith(
      "dir-1",
      expect.objectContaining({
        version: { increment: 1 },
        status: "GENERATED",
        userEdited: false,
        userNotes: "Keep this note",
        designDirectionName: "Direction 1",
      })
    );
    expect(AiGarmentDesignDirectionRepository.recomputeRecommendations).toHaveBeenCalledWith("proj-1");
  });

  it("maps a regeneration failure without persisting a partial/fabricated result", async () => {
    vi.mocked(AiGarmentDesignDirectionRepository.findWithProjectOwner).mockResolvedValue({
      id: "dir-1",
      projectId: "proj-1",
      developmentBriefRunId: "run-1",
      version: 1,
      userNotes: null,
      status: "GENERATED",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(AiGarmentDevelopmentBriefRunRepository.findById).mockResolvedValue({
      id: "run-1",
      designBalance: "BALANCED",
      contextSnapshotJson: {},
    } as never);
    vi.mocked(aiRegenerate).mockRejectedValue(new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT"));

    await expect(regenerateDesignDirection(actor, "dir-1")).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentDesignDirectionRepository.update).not.toHaveBeenCalled();
  });
});

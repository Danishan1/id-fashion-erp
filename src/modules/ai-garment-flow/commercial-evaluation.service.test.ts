import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/commercial-evaluation/generate", () => ({
  generateCommercialEvaluation: vi.fn(),
  PROMPT_VERSION: "commercial-evaluation-v1",
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
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn(), update: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findByProjectId: vi.fn(), findManyByIds: vi.fn(), findWithProjectOwner: vi.fn() },
}));
vi.mock("./ai-garment-project.service", () => ({ saveWorkflowStep: vi.fn() }));
vi.mock("./commercial-evaluation.repository", () => ({
  AiGarmentCommercialEvaluationRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentCommercialEvaluationRepository: { create: vi.fn(), findLatestByProjectId: vi.fn(), findById: vi.fn() },
  AiGarmentCommercialEvaluationItemRepository: { findWithProjectOwner: vi.fn(), setUserRankExclusive: vi.fn() },
}));

const { generateCommercialEvaluation, AiConfigMissingError, AiServiceError } = await import("@/core/ai/commercial-evaluation/generate");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { saveWorkflowStep } = await import("./ai-garment-project.service");
const {
  AiGarmentCommercialEvaluationRunRepository,
  AiGarmentCommercialEvaluationRepository,
  AiGarmentCommercialEvaluationItemRepository,
} = await import("./commercial-evaluation.repository");
const {
  listEligibleDesignsForComparison,
  createCommercialEvaluation,
  getLatestCommercialEvaluation,
  overrideCommercialRank,
  selectDesignForDevelopment,
} = await import("./commercial-evaluation.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: null,
  buyer: { id: "buyer-1", name: "Big Buyer Inc" },
  customer: { id: "cust-1", name: "Acme Retail" },
  targetMarket: "USA",
  season: { id: "season-1", name: "Spring 2027" },
  targetSellingPrice: 25,
  currencyCode: "USD",
  orderQuantityEstimate: 5000,
  fabricDetail: null,
};

function makeDirection(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    projectId: "proj-1",
    status: "APPROVED",
    designDirectionName: `Design ${id}`,
    commercialClassification: "BALANCED",
    targetConsumer: "Young professionals",
    silhouette: "A-line",
    garmentLength: "Hip",
    fit: "Relaxed",
    neckline: "Crew",
    collar: "None",
    sleeve: "Short",
    closure: "Pullover",
    pocket: "None",
    waistTreatment: "Straight",
    hem: "Straight",
    keyNewDesignFeature: "Contrast placket",
    suggestedFabricCharacter: "Cotton poplin",
    suggestedTrims: "None",
    productionComplexity: "LOW",
    expectedFabricConsumption: "LOW",
    targetPriceCompatibilityLevel: "MEDIUM",
    commercialRationale: "Broad appeal.",
    manufacturingRisk: "Low.",
    project: { companyId: "co-1" },
    ...overrides,
  };
}

function fakeAiItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    targetCustomerFitScore: 8,
    buyerFitScore: 7,
    fabricSuitabilityScore: 9,
    commercialAppealScore: 8,
    manufacturingSimplicityScore: 9,
    fabricConsumptionEfficiencyScore: 8,
    patternMakingComplexityScore: 9,
    sewingComplexityScore: 9,
    trimComplexityScore: 10,
    targetPriceCompatibilityScore: 7,
    bulkProductionScalabilityScore: 8,
    designFreshnessScore: 6,
    strengths: "Simple, sellable.",
    weaknesses: "Not very fresh.",
    manufacturingRisks: "None significant.",
    potentialCostRisks: "Low.",
    suggestedImprovement: "Add a trim detail.",
    rank: "FIRST_CHOICE",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentCommercialEvaluationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentCommercialEvaluationRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (AiGarmentCommercialEvaluationRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue("eval-1");
  (AiGarmentCommercialEvaluationRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "eval-1" });
});

describe("listEligibleDesignsForComparison", () => {
  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(listEligibleDesignsForComparison("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns only APPROVED design directions", async () => {
    (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirection("d1", { status: "APPROVED" }),
      makeDirection("d2", { status: "GENERATED" }),
      makeDirection("d3", { status: "APPROVED" }),
    ]);
    const result = await listEligibleDesignsForComparison("co-1", "proj-1");
    expect(result.map((d) => d.id)).toEqual(["d1", "d3"]);
  });
});

describe("createCommercialEvaluation", () => {
  beforeEach(() => {
    (AiGarmentDesignDirectionRepository.findManyByIds as ReturnType<typeof vi.fn>).mockResolvedValue([makeDirection("d1"), makeDirection("d2")]);
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(createCommercialEvaluation(actor, "proj-x", { designDirectionIds: ["d1", "d2"] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a second compare call while one is already in progress for this project", async () => {
    (AiGarmentCommercialEvaluationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects a design id that doesn't belong to this project", async () => {
    (AiGarmentDesignDirectionRepository.findManyByIds as ReturnType<typeof vi.fn>).mockResolvedValue([makeDirection("d1")]);
    await expect(createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a design that is not APPROVED", async () => {
    (AiGarmentDesignDirectionRepository.findManyByIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDirection("d1"),
      makeDirection("d2", { status: "GENERATED" }),
    ]);
    await expect(createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (generateCommercialEvaluation as ReturnType<typeof vi.fn>).mockRejectedValue(new AiConfigMissingError("ANTHROPIC_API_KEY is missing."));

    await expect(createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] })).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
    });

    expect(AiGarmentCommercialEvaluationRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentCommercialEvaluationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentCommercialEvaluationRepository.create).not.toHaveBeenCalled();
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    (generateCommercialEvaluation as ReturnType<typeof vi.fn>).mockRejectedValue(new AiServiceError("Timed out.", "TIMEOUT"));
    await expect(createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] })).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
    });
    expect(AiGarmentCommercialEvaluationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("zips the AI's positional response back to the real design ids in the requested order, and computes the score server-side", async () => {
    (generateCommercialEvaluation as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [fakeAiItem({ rank: "SECOND_CHOICE" }), fakeAiItem({ rank: "FIRST_CHOICE" })],
      overallRankingRationale: "Design d2 wins on price compatibility.",
      model: "claude-sonnet-5",
      rawResponse: {},
    });

    await createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] });

    expect(AiGarmentCommercialEvaluationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", overallRankingRationale: "Design d2 wins on price compatibility." }),
      [
        expect.objectContaining({ designDirectionId: "d1", aiRank: "SECOND_CHOICE" }),
        expect.objectContaining({ designDirectionId: "d2", aiRank: "FIRST_CHOICE" }),
      ]
    );
    expect(AiGarmentCommercialEvaluationRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });

  it("computes the exact weighted commercialDevelopmentScore from a known set of scores", async () => {
    // commercialAppeal=8 buyerFit=6 targetPriceCompat=4 -> (8+6+4)*1.5=27
    // manufacturingSimplicity=10 fabricSuitability=10 consumptionEff=10 scalability=10 freshness=10 -> 5*10*1.0=50
    // otherTechnicalFactors avg(targetCustomerFit=4, patternMaking=4, sewing=4, trim=4)=4 -> 4*0.5=2
    // total = 27+50+2 = 79
    (generateCommercialEvaluation as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        fakeAiItem({
          commercialAppealScore: 8,
          buyerFitScore: 6,
          targetPriceCompatibilityScore: 4,
          manufacturingSimplicityScore: 10,
          fabricSuitabilityScore: 10,
          fabricConsumptionEfficiencyScore: 10,
          bulkProductionScalabilityScore: 10,
          designFreshnessScore: 10,
          targetCustomerFitScore: 4,
          patternMakingComplexityScore: 4,
          sewingComplexityScore: 4,
          trimComplexityScore: 4,
          rank: "FIRST_CHOICE",
        }),
        fakeAiItem({ rank: "SECOND_CHOICE" }),
      ],
      overallRankingRationale: "Reasoning.",
      model: "claude-sonnet-5",
      rawResponse: {},
    });

    await createCommercialEvaluation(actor, "proj-1", { designDirectionIds: ["d1", "d2"] });

    expect(AiGarmentCommercialEvaluationRepository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ designDirectionId: "d1", commercialDevelopmentScore: 79 })])
    );
  });
});

describe("getLatestCommercialEvaluation", () => {
  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getLatestCommercialEvaluation("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("overrideCommercialRank", () => {
  const item = { id: "item-1", evaluationId: "eval-1", userRank: null, evaluation: { project: { companyId: "co-1" } } };

  beforeEach(() => {
    (AiGarmentCommercialEvaluationItemRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(item);
    (AiGarmentCommercialEvaluationItemRepository.setUserRankExclusive as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "item-1",
      userRank: "FIRST_CHOICE",
    });
  });

  it("rejects an item that doesn't belong to this company", async () => {
    (AiGarmentCommercialEvaluationItemRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...item,
      evaluation: { project: { companyId: "other-co" } },
    });
    await expect(overrideCommercialRank(actor, "item-1", { userRank: "FIRST_CHOICE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires no confirmation to override a rank", async () => {
    await overrideCommercialRank(actor, "item-1", { userRank: "FIRST_CHOICE" });
    expect(AiGarmentCommercialEvaluationItemRepository.setUserRankExclusive).toHaveBeenCalledWith("eval-1", "item-1", "FIRST_CHOICE");
  });

  it("clears the override when userRank is null", async () => {
    await overrideCommercialRank(actor, "item-1", { userRank: null });
    expect(AiGarmentCommercialEvaluationItemRepository.setUserRankExclusive).toHaveBeenCalledWith("eval-1", "item-1", null);
  });
});

describe("selectDesignForDevelopment", () => {
  beforeEach(() => {
    (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(makeDirection("d1"));
    (AiGarmentProjectRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "proj-1", selectedDesignDirectionId: "d1" });
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(selectDesignForDevelopment(actor, "proj-x", { designDirectionId: "d1", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires explicit confirmation", async () => {
    await expect(selectDesignForDevelopment(actor, "proj-1", { designDirectionId: "d1", confirmed: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a design direction that is not APPROVED", async () => {
    (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDirection("d1", { status: "GENERATED" })
    );
    await expect(selectDesignForDevelopment(actor, "proj-1", { designDirectionId: "d1", confirmed: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a design direction belonging to a different project", async () => {
    (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDirection("d1", { projectId: "other-proj" })
    );
    await expect(selectDesignForDevelopment(actor, "proj-1", { designDirectionId: "d1", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("records the selection and advances the workflow to APPLY_FABRIC for a REFERENCE-sourced project", async () => {
    await selectDesignForDevelopment(actor, "proj-1", { designDirectionId: "d1", confirmed: true });

    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ selectedDesignDirectionId: "d1", selectedDesignByUserId: "user-1" })
    );
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(1, actor, "proj-1", { stepKey: "SELECT_DESIGN" });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "APPLY_FABRIC" });
  });

  it("advances to TECHNICAL_DEVELOPMENT instead, for a FABRIC-sourced project (no Apply Fabric step exists there)", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, sourceType: "FABRIC" });
    await selectDesignForDevelopment(actor, "proj-1", { designDirectionId: "d1", confirmed: true });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "TECHNICAL_DEVELOPMENT" });
  });
});

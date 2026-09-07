import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/cost-analysis/generate", () => ({
  generateCostAnalysis: vi.fn(),
  AiConfigMissingError: class AiConfigMissingError extends Error {},
  AiInvalidResponseError: class AiInvalidResponseError extends Error {},
  AiServiceError: class AiServiceError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.category = category;
    }
  },
  PROMPT_VERSION: "cost-analysis-v1",
}));
vi.mock("@/modules/bom-mrp/bom.service", () => ({ getBomByProductId: vi.fn() }));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleVersionRepository: { findLatest: vi.fn() },
}));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn(), markCostingComplete: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findById: vi.fn() },
}));
vi.mock("./fabric-detail-description", () => ({ describeFabricDetail: vi.fn().mockReturnValue(null) }));
vi.mock("./ai-garment-project.service", () => ({ saveWorkflowStep: vi.fn() }));
vi.mock("./cost-analysis.repository", () => ({
  AiGarmentCostAnalysisRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentCostAnalysisRepository: { create: vi.fn(), findLatestByProjectId: vi.fn() },
}));

const { generateCostAnalysis: callAi, AiConfigMissingError, AiServiceError } = await import("@/core/ai/cost-analysis/generate");
const { getBomByProductId } = await import("@/modules/bom-mrp/bom.service");
const { SampleVersionRepository } = await import("@/modules/sampling/sample.repository");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { saveWorkflowStep } = await import("./ai-garment-project.service");
const { AiGarmentCostAnalysisRunRepository, AiGarmentCostAnalysisRepository } = await import("./cost-analysis.repository");
const { generateCostAnalysis, getLatestCostAnalysis, completeCostingStep } = await import("./cost-analysis.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: "dir-1",
  productId: null as string | null,
  sampleRequestId: null as string | null,
  fabricDetail: null,
  targetMarket: null,
  targetSellingPrice: null,
  currencyCode: "INR",
  orderQuantityEstimate: null,
};

const direction = {
  id: "dir-1",
  designDirectionName: "Classic Tee",
  silhouette: "x",
  garmentLength: "x",
  fit: "x",
  neckline: "x",
  collar: "x",
  sleeve: "x",
  closure: "x",
  pocket: "x",
  waistTreatment: "x",
  hem: "x",
  keyNewDesignFeature: "x",
  suggestedFabricCharacter: "x",
  suggestedTrims: "x",
};

const aiResult = {
  estimatedCostPerUnitLow: 200,
  estimatedCostPerUnitHigh: 260,
  costBreakdownCommentary: "Fabric dominates.",
  pricePositioningCommentary: "Reasonable.",
  marginFeasibilityCommentary: "Achievable.",
  riskNotes: "None major.",
  model: "claude-sonnet-5",
  rawResponse: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentDesignDirectionRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(direction);
  (AiGarmentCostAnalysisRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentCostAnalysisRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (AiGarmentCostAnalysisRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "analysis-1", ...aiResult });
  (SampleVersionRepository.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("generateCostAnalysis", () => {
  it("rejects a project with no design selected yet", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    await expect(generateCostAnalysis(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a second call while one is already in progress for this project", async () => {
    (AiGarmentCostAnalysisRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(generateCostAnalysis(actor, "proj-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiConfigMissingError("ANTHROPIC_API_KEY is missing."));

    await expect(generateCostAnalysis(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentCostAnalysisRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentCostAnalysisRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentCostAnalysisRepository.create).not.toHaveBeenCalled();
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiServiceError("Timed out.", "TIMEOUT"));

    await expect(generateCostAnalysis(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentCostAnalysisRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("persists the analysis and marks the run SUCCESS, including additionalGuidance in the prompt context", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue(aiResult);

    await generateCostAnalysis(actor, "proj-1", { additionalGuidance: "Target a premium price point" });

    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ additionalGuidance: "Target a premium price point" }));
    expect(AiGarmentCostAnalysisRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", estimatedCostPerUnitLow: 200, estimatedCostPerUnitHigh: 260 })
    );
    expect(AiGarmentCostAnalysisRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });

  it("includes a resolved BOM summary in the prompt context once the project has graduated to a Style with a real BOM", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue(aiResult);
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      productId: "style-1",
    });
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({
      bom: {
        currentVersionNumber: 1,
        versions: [
          {
            versionNumber: 1,
            items: [{ material: { styleName: "Cotton Fabric" }, quantityPerUnit: "1.5", uom: { code: "MTR" }, wastagePercentage: "10" }],
          },
        ],
      },
    });

    await generateCostAnalysis(actor, "proj-1", {});

    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ bomSummary: expect.stringContaining("Cotton Fabric") }));
  });

  it("includes real Sampling costing figures in the prompt context once the linked Sample Request is priced", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue(aiResult);
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      sampleRequestId: "sam-1",
    });
    (SampleVersionRepository.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue({
      costSubtotal: "300", finalTotal: "345", marginPercent: "10", commissionPercent: "5", freightAmount: "20",
    });

    await generateCostAnalysis(actor, "proj-1", {});

    expect(callAi).toHaveBeenCalledWith(
      expect.objectContaining({ realSampleCosting: { costSubtotal: 300, finalTotal: 345, marginPercent: 10, commissionPercent: 5, freightAmount: 20 } })
    );
  });
});

describe("getLatestCostAnalysis", () => {
  it("returns null, not an error, when nothing has been generated yet", async () => {
    (AiGarmentCostAnalysisRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await getLatestCostAnalysis("co-1", "proj-1");
    expect(result).toBeNull();
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getLatestCostAnalysis("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("completeCostingStep", () => {
  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(completeCostingStep(actor, "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when no Sample Request has been linked yet", async () => {
    await expect(completeCostingStep(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(saveWorkflowStep).not.toHaveBeenCalled();
  });

  it("rejects when the linked Sample Request's current version hasn't been priced yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, sampleRequestId: "sam-1" });
    (SampleVersionRepository.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue({ finalTotal: null });
    await expect(completeCostingStep(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(saveWorkflowStep).not.toHaveBeenCalled();
  });

  it("marks the project's own workflow complete once real costing exists", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, sampleRequestId: "sam-1" });
    (SampleVersionRepository.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue({ finalTotal: "345" });

    await completeCostingStep(actor, "proj-1");

    expect(saveWorkflowStep).toHaveBeenCalledWith(actor, "proj-1", { stepKey: "COSTING" });
    expect(AiGarmentProjectRepository.markCostingComplete).toHaveBeenCalledWith("proj-1", "user-1");
  });
});

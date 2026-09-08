import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/value-engineering/generate", () => ({
  generateValueEngineering: vi.fn(),
  AiConfigMissingError: class AiConfigMissingError extends Error {},
  AiInvalidResponseError: class AiInvalidResponseError extends Error {},
  AiServiceError: class AiServiceError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.category = category;
    }
  },
  PROMPT_VERSION: "value-engineering-v1",
}));
vi.mock("@/modules/bom-mrp/bom.service", () => ({ getBomByProductId: vi.fn() }));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findById: vi.fn() },
}));
vi.mock("./fabric-detail-description", () => ({ describeFabricDetail: vi.fn().mockReturnValue(null) }));
vi.mock("./cost-analysis.repository", () => ({
  AiGarmentCostAnalysisRepository: { findLatestByProjectId: vi.fn() },
}));
vi.mock("./value-engineering.repository", () => ({
  AiGarmentValueEngineeringRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentValueEngineeringRepository: { create: vi.fn(), findLatestByProjectId: vi.fn() },
}));

const { generateValueEngineering: callAi, AiConfigMissingError, AiServiceError } = await import(
  "@/core/ai/value-engineering/generate"
);
const { getBomByProductId } = await import("@/modules/bom-mrp/bom.service");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { AiGarmentCostAnalysisRepository } = await import("./cost-analysis.repository");
const { AiGarmentValueEngineeringRunRepository, AiGarmentValueEngineeringRepository } = await import(
  "./value-engineering.repository"
);
const { generateValueEngineering, getLatestValueEngineering } = await import("./value-engineering.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: "dir-1",
  productId: "style-1" as string | null,
  fabricDetail: null,
  currencyCode: "INR",
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
  waistTreatment: "x",
  hem: "x",
};

const approvedBomWithItems = {
  approvedVersionId: "ver-1",
  approvedVersion: {
    id: "ver-1",
    items: [
      {
        material: { styleName: "Cotton Fabric", unitCost: "50" },
        color: null,
        quantityPerUnit: "1.5",
        wastagePercentage: "10",
        uom: { code: "MTR" },
      },
      {
        material: { styleName: "Metal Zipper", unitCost: null },
        color: { name: "Black" },
        quantityPerUnit: "1",
        wastagePercentage: "0",
        uom: { code: "PCS" },
      },
    ],
  },
};

const aiResult = {
  data: {
    overallSummary: "Fabric dominates this style's cost.",
    suggestions: [
      {
        materialDescription: "Cotton Fabric",
        suggestedChange: "Switch to a lighter-weight 160 GSM alternative.",
        costImpactDirection: "LOWER" as const,
        qualityRiskNotes: "May reduce hand-feel slightly.",
        reasoning: "Fabric is the dominant cost line.",
      },
    ],
  },
  model: "claude-sonnet-5",
  rawResponse: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentDesignDirectionRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(direction);
  (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ bom: approvedBomWithItems });
  (AiGarmentCostAnalysisRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentValueEngineeringRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentValueEngineeringRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (AiGarmentValueEngineeringRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "analysis-1",
    suggestions: [{ id: "sugg-1" }],
  });
  (callAi as ReturnType<typeof vi.fn>).mockResolvedValue(aiResult);
});

describe("generateValueEngineering", () => {
  it("rejects a project that hasn't graduated to a Style yet", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      productId: null,
    });
    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("rejects a project with no design selected yet", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when the style's BOM has never been approved", async () => {
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ bom: { approvedVersionId: null, approvedVersion: null } });
    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("rejects when the approved BOM has zero lines", async () => {
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({
      bom: { approvedVersionId: "ver-1", approvedVersion: { id: "ver-1", items: [] } },
    });
    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("rejects a second call while one is already in progress for this project", async () => {
    (AiGarmentValueEngineeringRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiConfigMissingError("ANTHROPIC_API_KEY is missing."));

    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentValueEngineeringRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentValueEngineeringRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentValueEngineeringRepository.create).not.toHaveBeenCalled();
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiServiceError("Timed out.", "TIMEOUT"));
    await expect(generateValueEngineering(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentValueEngineeringRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("computes a real per-piece cost contribution only when the material's own unitCost is set, 'Not Tracked' (null) otherwise", async () => {
    await generateValueEngineering(actor, "proj-1", {});

    expect(callAi).toHaveBeenCalledWith(
      expect.objectContaining({
        bomLines: [
          expect.objectContaining({ materialDescription: "Cotton Fabric", costPerPieceContribution: 50 * 1.5 * 1.1 }),
          expect.objectContaining({ materialDescription: "Metal Zipper (Black)", costPerPieceContribution: null }),
        ],
      })
    );
  });

  it("includes the latest Cost Analysis's own commentary as context when one already exists", async () => {
    (AiGarmentCostAnalysisRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({
      costBreakdownCommentary: "Fabric is the dominant line.",
    });
    await generateValueEngineering(actor, "proj-1", {});
    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ costAnalysisSummary: "Fabric is the dominant line." }));
  });

  it("persists the analysis with its suggestions and marks the run SUCCESS", async () => {
    await generateValueEngineering(actor, "proj-1", { additionalGuidance: "Focus on the fabric line" });

    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ additionalGuidance: "Focus on the fabric line" }));
    expect(AiGarmentValueEngineeringRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", overallSummary: "Fabric dominates this style's cost." }),
      [
        expect.objectContaining({
          materialDescription: "Cotton Fabric",
          costImpactDirection: "LOWER",
          sortOrder: 0,
        }),
      ]
    );
    expect(AiGarmentValueEngineeringRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });

  it("persists a genuinely empty suggestion list as a valid, honest result (not an error)", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { overallSummary: "This BOM already reads as lean.", suggestions: [] },
      model: "claude-sonnet-5",
      rawResponse: {},
    });

    await generateValueEngineering(actor, "proj-1", {});

    expect(AiGarmentValueEngineeringRepository.create).toHaveBeenCalledWith(expect.anything(), []);
    expect(AiGarmentValueEngineeringRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("getLatestValueEngineering", () => {
  it("returns null, not an error, when nothing has been generated yet", async () => {
    (AiGarmentValueEngineeringRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await getLatestValueEngineering("co-1", "proj-1");
    expect(result).toBeNull();
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getLatestValueEngineering("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

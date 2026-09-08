import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/product-suitability/generate", () => ({
  generateProductSuitability: vi.fn(),
  PROMPT_VERSION: "product-suitability-v1",
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
vi.mock("@/modules/garment-attributes/garment-attributes.repository", () => ({
  GarmentAttributeRepository: { productType: { findMany: vi.fn() } },
}));
vi.mock("./product-suitability.repository", () => ({
  AiGarmentProductSuitabilityRepository: {
    findByProjectId: vi.fn(),
    replaceForProject: vi.fn(),
    approveWithItems: vi.fn(),
    updateStatus: vi.fn(),
  },
  AiGarmentProductSuitabilityItemRepository: {
    findWithSuitabilityOwner: vi.fn(),
    update: vi.fn(),
  },
  AiGarmentProductSuitabilityRunRepository: {
    findActiveSince: vi.fn(),
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  },
}));

const { generateProductSuitability, AiConfigMissingError, AiServiceError, AiInvalidResponseError } = await import(
  "@/core/ai/product-suitability/generate"
);
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentFabricAnalysisRepository } = await import("./fabric-analysis.repository");
const { GarmentAttributeRepository } = await import("@/modules/garment-attributes/garment-attributes.repository");
const {
  AiGarmentProductSuitabilityRepository,
  AiGarmentProductSuitabilityItemRepository,
  AiGarmentProductSuitabilityRunRepository,
} = await import("./product-suitability.repository");
const {
  getProductSuitability,
  runProductSuitability,
  updateSuitabilityItem,
  resetSuitabilityItemToAi,
  approveProductSuitability,
} = await import("./product-suitability.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  buyer: { name: "Big Buyer Inc" },
  customer: { name: "Acme Retail" },
  targetMarket: "USA",
  season: { name: "Spring 2027" },
  targetSellingPrice: 25,
  currencyCode: "USD",
  fabricDetail: null,
};

const approvedFabricAnalysis = {
  id: "analysis-1",
  status: "APPROVED",
  fabricSummary: "A medium-weight cotton-blend single jersey knit.",
  observations: [
    { featureKey: "fabricType", approvedObservation: "Single jersey knit" },
    { featureKey: "estimatedStretch", approvedObservation: "Moderate two-way stretch" },
  ],
};

const activeProductTypes = [
  { id: "pt-1", code: "T-SHIRT", name: "T-Shirt" },
  { id: "pt-2", code: "BLAZER", name: "Blazer" },
];

beforeEach(() => {
  vi.mocked(generateProductSuitability).mockReset();
  vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockReset().mockResolvedValue(baseProject as never);
  vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockReset().mockResolvedValue(approvedFabricAnalysis as never);
  vi.mocked(GarmentAttributeRepository.productType.findMany).mockReset().mockResolvedValue(activeProductTypes as never);
  vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockReset();
  vi.mocked(AiGarmentProductSuitabilityRepository.replaceForProject).mockReset();
  vi.mocked(AiGarmentProductSuitabilityRepository.approveWithItems).mockReset();
  vi.mocked(AiGarmentProductSuitabilityRepository.updateStatus).mockReset();
  vi.mocked(AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner).mockReset();
  vi.mocked(AiGarmentProductSuitabilityItemRepository.update).mockReset();
  vi.mocked(AiGarmentProductSuitabilityRunRepository.findActiveSince).mockReset().mockResolvedValue(null);
  vi.mocked(AiGarmentProductSuitabilityRunRepository.create).mockReset().mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(AiGarmentProductSuitabilityRunRepository.markSuccess).mockReset();
  vi.mocked(AiGarmentProductSuitabilityRunRepository.markFailed).mockReset();
});

describe("getProductSuitability", () => {
  it("rejects for a project not found", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue(null as never);
    await expect(getProductSuitability("co-1", "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("runProductSuitability", () => {
  it("rejects when no Fabric Analysis exists yet", async () => {
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue(null);

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      message: expect.stringContaining("must be approved"),
    });
    expect(generateProductSuitability).not.toHaveBeenCalled();
  });

  it("rejects when the Fabric Analysis is not yet approved", async () => {
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue({
      ...approvedFabricAnalysis,
      status: "UNDER_REVIEW",
    } as never);

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(generateProductSuitability).not.toHaveBeenCalled();
  });

  it("rejects when the company has zero active Product Types", async () => {
    vi.mocked(GarmentAttributeRepository.productType.findMany).mockResolvedValue([]);

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("No active Product Types"),
    });
    expect(generateProductSuitability).not.toHaveBeenCalled();
  });

  it("blocks a duplicate request while a run is already in progress", async () => {
    vi.mocked(AiGarmentProductSuitabilityRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentProductSuitabilityRunRepository.create).not.toHaveBeenCalled();
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(generateProductSuitability).mockRejectedValue(new AiConfigMissingError("AI service configuration is missing."));

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
      message: "AI service configuration is missing.",
    });
    expect(AiGarmentProductSuitabilityRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "MISSING_CONFIG",
      "AI service configuration is missing."
    );
    expect(AiGarmentProductSuitabilityRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it("maps a provider timeout to AI_SERVICE_ERROR", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(generateProductSuitability).mockRejectedValue(
      new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT")
    );

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentProductSuitabilityRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "TIMEOUT",
      "AI analysis could not be completed. Please try again."
    );
  });

  it("maps an invalid structured response to AI_INVALID_RESPONSE and never saves it", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(generateProductSuitability).mockRejectedValue(new AiInvalidResponseError("AI returned an invalid structured response."));

    await expect(runProductSuitability(actor, "proj-1")).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(AiGarmentProductSuitabilityRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it("zips the positional AI response back to the real ProductType ids and marks the run SUCCESS", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId)
      .mockResolvedValueOnce(null) // pre-check for nextVersion
      .mockResolvedValueOnce({ id: "suitability-1", items: [] } as never); // final re-read after replace
    vi.mocked(generateProductSuitability).mockResolvedValue({
      model: "claude-sonnet-5",
      rawResponse: { fake: true },
      overallSummary: "Casual knitwear for everyday wear.",
      items: [
        { rating: "HIGHLY_SUITABLE", reasoning: "Stretch and drape suit a fitted tee." },
        { rating: "NOT_SUITABLE", reasoning: "No structure for a tailored blazer." },
      ],
    } as never);
    vi.mocked(AiGarmentProductSuitabilityRepository.replaceForProject).mockResolvedValue({
      id: "suitability-1",
      analysisVersion: 1,
    } as never);

    const result = await runProductSuitability(actor, "proj-1");

    expect(AiGarmentProductSuitabilityRepository.replaceForProject).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ status: "AI_ANALYSED", analysisVersion: 1, model: "claude-sonnet-5" }),
      [
        { productTypeId: "pt-1", aiRating: "HIGHLY_SUITABLE", aiReasoning: "Stretch and drape suit a fitted tee.", approvedRating: "HIGHLY_SUITABLE" },
        { productTypeId: "pt-2", aiRating: "NOT_SUITABLE", aiReasoning: "No structure for a tailored blazer.", approvedRating: "NOT_SUITABLE" },
      ]
    );
    expect(AiGarmentProductSuitabilityRunRepository.markSuccess).toHaveBeenCalledWith("run-1", "suitability-1");
    expect(result).toEqual({ id: "suitability-1", items: [] });
  });
});

describe("updateSuitabilityItem / resetSuitabilityItemToAi", () => {
  const owned = (overrides = {}) => ({
    id: "item-1",
    suitabilityId: "suitability-1",
    aiRating: "SUITABLE",
    approvedRating: "SUITABLE",
    userEdited: false,
    suitability: { status: "AI_ANALYSED", project: { companyId: "co-1" } },
    ...overrides,
  });

  it("rejects an item belonging to another company", async () => {
    vi.mocked(AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner).mockResolvedValue({
      ...owned(),
      suitability: { status: "AI_ANALYSED", project: { companyId: "other-co" } },
    } as never);

    await expect(updateSuitabilityItem(actor, "item-1", "HIGHLY_SUITABLE")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(AiGarmentProductSuitabilityItemRepository.update).not.toHaveBeenCalled();
  });

  it("stores the override rating and marks userEdited", async () => {
    vi.mocked(AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner).mockResolvedValue(owned() as never);

    await updateSuitabilityItem(actor, "item-1", "HIGHLY_SUITABLE");

    expect(AiGarmentProductSuitabilityItemRepository.update).toHaveBeenCalledWith("item-1", {
      approvedRating: "HIGHLY_SUITABLE",
      userEdited: true,
    });
  });

  it("bumps a fresh AI_ANALYSED assessment to UNDER_REVIEW on first edit", async () => {
    vi.mocked(AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner).mockResolvedValue(owned() as never);
    await updateSuitabilityItem(actor, "item-1", "HIGHLY_SUITABLE");
    expect(AiGarmentProductSuitabilityRepository.updateStatus).toHaveBeenCalledWith("suitability-1", "UNDER_REVIEW");
  });

  it("blocks editing an item on a STALE assessment", async () => {
    vi.mocked(AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner).mockResolvedValue(
      owned({ suitability: { status: "STALE", project: { companyId: "co-1" } } }) as never
    );

    await expect(updateSuitabilityItem(actor, "item-1", "HIGHLY_SUITABLE")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentProductSuitabilityItemRepository.update).not.toHaveBeenCalled();
  });

  it("restores the AI rating and clears userEdited on reset", async () => {
    vi.mocked(AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner).mockResolvedValue(
      owned({ approvedRating: "HIGHLY_SUITABLE", userEdited: true }) as never
    );

    await resetSuitabilityItemToAi(actor, "item-1");

    expect(AiGarmentProductSuitabilityItemRepository.update).toHaveBeenCalledWith("item-1", {
      approvedRating: "SUITABLE",
      userEdited: false,
    });
  });
});

describe("approveProductSuitability", () => {
  it("rejects approving when no assessment exists yet", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue(null);
    await expect(approveProductSuitability(actor, "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects approving a STALE assessment", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue({ id: "suitability-1", status: "STALE" } as never);

    await expect(approveProductSuitability(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentProductSuitabilityRepository.approveWithItems).not.toHaveBeenCalled();
  });

  it("bulk-stamps approval on both the header and every item", async () => {
    vi.mocked(AiGarmentProductSuitabilityRepository.findByProjectId).mockResolvedValue({
      id: "suitability-1",
      status: "UNDER_REVIEW",
    } as never);
    vi.mocked(AiGarmentProductSuitabilityRepository.approveWithItems).mockResolvedValue({
      id: "suitability-1",
      status: "APPROVED",
    } as never);

    await approveProductSuitability(actor, "proj-1");

    expect(AiGarmentProductSuitabilityRepository.approveWithItems).toHaveBeenCalledWith("suitability-1", "user-1");
  });
});

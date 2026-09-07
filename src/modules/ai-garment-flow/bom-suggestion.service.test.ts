import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/ai/bom-suggestion/generate", () => ({
  generateBomSuggestions: vi.fn(),
  AiConfigMissingError: class AiConfigMissingError extends Error {},
  AiInvalidResponseError: class AiInvalidResponseError extends Error {},
  AiServiceError: class AiServiceError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.category = category;
    }
  },
  PROMPT_VERSION: "bom-suggestion-v1",
}));
vi.mock("@/modules/bom-mrp/bom.service", () => ({ getBomByProductId: vi.fn(), upsertBom: vi.fn() }));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findById: vi.fn() },
}));
vi.mock("./fabric-detail-description", () => ({ describeFabricDetail: vi.fn().mockReturnValue(null) }));
vi.mock("./ai-garment-project.service", () => ({ saveWorkflowStep: vi.fn() }));
vi.mock("./bom-suggestion.repository", () => ({
  AiGarmentBomSuggestionRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentBomSuggestionRepository: {
    createMany: vi.fn(),
    findByDesignDirectionId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    markAdded: vi.fn(),
    markDismissed: vi.fn(),
  },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateBomSuggestions: callAi, AiConfigMissingError, AiServiceError } = await import("@/core/ai/bom-suggestion/generate");
const { getBomByProductId, upsertBom } = await import("@/modules/bom-mrp/bom.service");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { saveWorkflowStep } = await import("./ai-garment-project.service");
const { AiGarmentBomSuggestionRunRepository, AiGarmentBomSuggestionRepository } = await import("./bom-suggestion.repository");
const {
  generateBomSuggestions,
  listBomSuggestions,
  resolveBomSuggestion,
  dismissBomSuggestion,
  completeBomStep,
} = await import("./bom-suggestion.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: "dir-1",
  productId: null as string | null,
  fabricDetail: null,
  targetMarket: null,
  season: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentDesignDirectionRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(direction);
  (AiGarmentBomSuggestionRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentBomSuggestionRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (AiGarmentBomSuggestionRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("generateBomSuggestions", () => {
  it("rejects a project with no design selected yet", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    await expect(generateBomSuggestions(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a second call while one is already in progress for this design", async () => {
    (AiGarmentBomSuggestionRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(generateBomSuggestions(actor, "proj-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiConfigMissingError("ANTHROPIC_API_KEY is missing."));

    await expect(generateBomSuggestions(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentBomSuggestionRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentBomSuggestionRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentBomSuggestionRepository.createMany).not.toHaveBeenCalled();
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiServiceError("Timed out.", "TIMEOUT"));

    await expect(generateBomSuggestions(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentBomSuggestionRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("persists every suggested item and marks the run SUCCESS, including additionalGuidance in the prompt context", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        {
          materialDescription: "100% Cotton Jersey, 180 GSM",
          materialCategory: "FABRIC",
          suggestedQuantityPerUnit: 1.2,
          suggestedUom: "MTR",
          suggestedWastagePercentage: 10,
          colorNote: "Navy",
          reasoning: "Main body fabric.",
        },
      ],
      model: "claude-sonnet-5",
      rawResponse: {},
    });

    await generateBomSuggestions(actor, "proj-1", { additionalGuidance: "Needs a concealed zip" });

    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ additionalGuidance: "Needs a concealed zip" }));
    expect(AiGarmentBomSuggestionRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ materialDescription: "100% Cotton Jersey, 180 GSM", materialCategory: "FABRIC", colorNote: "Navy" }),
    ]);
    expect(AiGarmentBomSuggestionRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("listBomSuggestions", () => {
  it("returns an empty list, not an error, when no design has been selected yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    const result = await listBomSuggestions("co-1", "proj-1");
    expect(result).toEqual([]);
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(listBomSuggestions("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("resolveBomSuggestion", () => {
  const pendingSuggestion = {
    id: "sugg-1",
    projectId: "proj-1",
    decision: "PENDING",
    project: { id: "proj-1", companyId: "co-1" },
  };
  const input = { materialId: "mat-1", colorId: "", quantityPerUnit: 1.2, wastagePercentage: 10, uomId: "uom-1", notes: "" };

  beforeEach(() => {
    (AiGarmentBomSuggestionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingSuggestion);
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, productId: "style-1" });
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ product: {}, bom: null });
    (upsertBom as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentVersionNumber: 1,
      versions: [{ versionNumber: 1, notes: null, items: [{ id: "item-1", material: { id: "mat-1" }, color: null, uom: { id: "uom-1" } }] }],
    });
    (AiGarmentBomSuggestionRepository.markAdded as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sugg-1", decision: "ADDED" });
  });

  it("rejects a suggestion that doesn't belong to this company", async () => {
    (AiGarmentBomSuggestionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingSuggestion,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(resolveBomSuggestion(actor, "sugg-1", input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a suggestion that has already been resolved or dismissed", async () => {
    (AiGarmentBomSuggestionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingSuggestion,
      decision: "ADDED",
    });
    await expect(resolveBomSuggestion(actor, "sugg-1", input)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects when the project hasn't graduated to a real Style yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, productId: null });
    await expect(resolveBomSuggestion(actor, "sugg-1", input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(upsertBom).not.toHaveBeenCalled();
  });

  it("asserts bom_mrp/edit before writing to the real BOM", async () => {
    await resolveBomSuggestion(actor, "sugg-1", input);
    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "bom_mrp", "edit");
  });

  it("appends the new line to any existing real BOM items and calls the existing upsertBom() unchanged", async () => {
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({
      product: {},
      bom: {
        currentVersionNumber: 1,
        versions: [
          {
            versionNumber: 1,
            notes: "existing notes",
            items: [
              {
                id: "existing-item",
                material: { id: "mat-existing" },
                color: { id: "color-existing" },
                uom: { id: "uom-existing" },
                quantityPerUnit: { toString: () => "2" },
                wastagePercentage: { toString: () => "5" },
                notes: null,
              },
            ],
          },
        ],
      },
    });

    await resolveBomSuggestion(actor, "sugg-1", input);

    expect(upsertBom).toHaveBeenCalledWith(
      actor,
      "style-1",
      expect.objectContaining({
        items: [expect.objectContaining({ materialId: "mat-existing", colorId: "color-existing" }), input],
      })
    );
  });

  it("marks the suggestion ADDED with the newly-created real BomItem's id", async () => {
    await resolveBomSuggestion(actor, "sugg-1", input);
    expect(AiGarmentBomSuggestionRepository.markAdded).toHaveBeenCalledWith("sugg-1", "item-1");
  });
});

describe("dismissBomSuggestion", () => {
  const pendingSuggestion = { id: "sugg-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentBomSuggestionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingSuggestion);
    (AiGarmentBomSuggestionRepository.markDismissed as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sugg-1", decision: "DISMISSED" });
  });

  it("rejects a suggestion that doesn't belong to this company", async () => {
    (AiGarmentBomSuggestionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingSuggestion,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(dismissBomSuggestion(actor, "sugg-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a suggestion that has already been resolved", async () => {
    (AiGarmentBomSuggestionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingSuggestion,
      decision: "ADDED",
    });
    await expect(dismissBomSuggestion(actor, "sugg-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("marks it DISMISSED", async () => {
    await dismissBomSuggestion(actor, "sugg-1");
    expect(AiGarmentBomSuggestionRepository.markDismissed).toHaveBeenCalledWith("sugg-1");
  });
});

describe("completeBomStep", () => {
  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(completeBomStep(actor, "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when the project hasn't graduated to a real Style yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, productId: null });
    await expect(completeBomStep(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when the style's BOM has no approved version yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, productId: "style-1" });
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ product: {}, bom: { approvedVersionId: null } });
    await expect(completeBomStep(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(saveWorkflowStep).not.toHaveBeenCalled();
  });

  it("advances the workflow from BOM to COSTING once the BOM is approved", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, productId: "style-1" });
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ product: {}, bom: { approvedVersionId: "version-1" } });

    await completeBomStep(actor, "proj-1");

    expect(saveWorkflowStep).toHaveBeenNthCalledWith(1, actor, "proj-1", { stepKey: "BOM" });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "COSTING" });
  });
});

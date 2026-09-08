import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/bom-mrp/bom.service", () => ({ getBomByProductId: vi.fn() }));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("./ai-garment-project.service", () => ({ getProductionStatusForProject: vi.fn() }));
vi.mock("./reference-analysis.repository", () => ({
  AiGarmentReferenceAnalysisRepository: { findByProjectId: vi.fn() },
}));
vi.mock("./fabric-analysis.repository", () => ({
  AiGarmentFabricAnalysisRepository: { findByProjectId: vi.fn() },
}));
vi.mock("./product-suitability.repository", () => ({
  AiGarmentProductSuitabilityRepository: { findByProjectId: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findByProjectId: vi.fn() },
}));
vi.mock("./visual-generation.repository", () => ({
  AiGarmentGeneratedImageRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./design-variation.repository", () => ({
  AiGarmentDesignVariationRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./commercial-evaluation.repository", () => ({
  AiGarmentCommercialEvaluationRepository: { findLatestByProjectId: vi.fn() },
}));
vi.mock("./fabric-application.repository", () => ({
  AiGarmentFabricApplicationRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./technical-development.repository", () => ({
  AiGarmentTechnicalFlatRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./technical-specification.repository", () => ({
  AiGarmentTechnicalSpecificationRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./bom-suggestion.repository", () => ({
  AiGarmentBomSuggestionRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./cost-analysis.repository", () => ({
  AiGarmentCostAnalysisRepository: { findLatestByProjectId: vi.fn() },
}));
vi.mock("./value-engineering.repository", () => ({
  AiGarmentValueEngineeringRepository: { findLatestByProjectId: vi.fn() },
}));
vi.mock("./buyer-comments.repository", () => ({
  AiGarmentBuyerCommentsRepository: { findLatestByProjectId: vi.fn() },
}));

const { getBomByProductId } = await import("@/modules/bom-mrp/bom.service");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { getProductionStatusForProject } = await import("./ai-garment-project.service");
const { AiGarmentReferenceAnalysisRepository } = await import("./reference-analysis.repository");
const { AiGarmentFabricAnalysisRepository } = await import("./fabric-analysis.repository");
const { AiGarmentProductSuitabilityRepository } = await import("./product-suitability.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { AiGarmentGeneratedImageRepository } = await import("./visual-generation.repository");
const { AiGarmentDesignVariationRepository } = await import("./design-variation.repository");
const { AiGarmentCommercialEvaluationRepository } = await import("./commercial-evaluation.repository");
const { AiGarmentFabricApplicationRepository } = await import("./fabric-application.repository");
const { AiGarmentTechnicalFlatRepository } = await import("./technical-development.repository");
const { AiGarmentTechnicalSpecificationRepository } = await import("./technical-specification.repository");
const { AiGarmentBomSuggestionRepository } = await import("./bom-suggestion.repository");
const { AiGarmentCostAnalysisRepository } = await import("./cost-analysis.repository");
const { AiGarmentValueEngineeringRepository } = await import("./value-engineering.repository");
const { AiGarmentBuyerCommentsRepository } = await import("./buyer-comments.repository");
const { getMerchandisingActionSheet } = await import("./merchandising-action-sheet.service");

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE" as const,
  status: "IDEA",
  currentStepKey: "PROJECT_INFO",
  completedStepKeys: [] as string[],
  projectNumber: "AGF-2026-00001",
  projectName: "Classic Tee",
  customer: { name: "Zenith Apparel" },
  buyer: { name: "Jane Buyer" },
  brand: { name: "Zenith Basics" },
  season: { name: "SS26" },
  category: { name: "T-Shirts" },
  targetMarket: "US Retail",
  targetCustomerProfile: "25-35 casualwear",
  targetSellingPrice: "12.00",
  currencyCode: "USD",
  orderQuantityEstimate: "5000",
  product: null as { styleCode: string; styleName: string } | null,
  productId: null as string | null,
  selectedDesignDirectionId: null as string | null,
  approvedFabricApplicationId: null as string | null,
  approvedTechnicalFlatId: null as string | null,
  approvedTechnicalSpecificationId: null as string | null,
  sampleRequestId: null as string | null,
  sampleRequest: null as { requestNumber: string; status: string } | null,
  salesOrderId: null as string | null,
  salesOrder: null as { orderNumber: string; status: string } | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentReferenceAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentFabricAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentProductSuitabilityRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentGeneratedImageRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentDesignVariationRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentCommercialEvaluationRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentFabricApplicationRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentTechnicalFlatRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentTechnicalSpecificationRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentBomSuggestionRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentCostAnalysisRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentValueEngineeringRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentBuyerCommentsRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ bom: null });
  (getProductionStatusForProject as ReturnType<typeof vi.fn>).mockResolvedValue({ hasSalesOrder: false, hasProductionOrder: false });
});

describe("getMerchandisingActionSheet", () => {
  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getMerchandisingActionSheet("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("makes no AI/network calls at all — purely reads existing repository data", async () => {
    await getMerchandisingActionSheet("co-1", "proj-1");
    // Every mocked dependency above is a plain repository read; none of them is an AI generate() call —
    // this test exists as a documentation/regression guard that nobody wires an AI call into this service later.
    expect(AiGarmentProjectRepository.findByIdWithDetails).toHaveBeenCalledWith("co-1", "proj-1");
  });

  it("for a REFERENCE-sourced project, reports Reference Analysis status and omits Fabric Analysis/Product Suitability", async () => {
    (AiGarmentReferenceAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "APPROVED" });
    const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
    expect(sheet.designDevelopment.referenceAnalysisStatus).toBe("APPROVED");
    expect(sheet.designDevelopment.fabricAnalysisStatus).toBeNull();
    expect(sheet.designDevelopment.productSuitability).toBeNull();
    expect(AiGarmentFabricAnalysisRepository.findByProjectId).not.toHaveBeenCalled();
  });

  it("for a FABRIC-sourced project, reports Fabric Analysis + Product Suitability and omits Reference Analysis", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, sourceType: "FABRIC" });
    (AiGarmentFabricAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "APPROVED" });
    (AiGarmentProductSuitabilityRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "APPROVED",
      items: [
        { approvedRating: "HIGHLY_SUITABLE" },
        { approvedRating: "SUITABLE" },
        { approvedRating: "NOT_SUITABLE" },
      ],
    });
    const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
    expect(sheet.designDevelopment.fabricAnalysisStatus).toBe("APPROVED");
    expect(sheet.designDevelopment.referenceAnalysisStatus).toBeNull();
    expect(sheet.designDevelopment.productSuitability).toEqual({ status: "APPROVED", highlySuitableCount: 1, suitableCount: 1 });
    expect(AiGarmentReferenceAnalysisRepository.findByProjectId).not.toHaveBeenCalled();
  });

  it("does not fan out to design-direction-scoped repositories when no direction is selected yet", async () => {
    await getMerchandisingActionSheet("co-1", "proj-1");
    expect(AiGarmentGeneratedImageRepository.findByDesignDirectionId).not.toHaveBeenCalled();
    expect(AiGarmentFabricApplicationRepository.findByDesignDirectionId).not.toHaveBeenCalled();
    expect(AiGarmentBomSuggestionRepository.findByDesignDirectionId).not.toHaveBeenCalled();
  });

  it("reports the selected design direction's own summary once one is selected", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, selectedDesignDirectionId: "dir-1" });
    (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "dir-1", designDirectionName: "Classic Crew Tee", overallScore: 85, commercialClassification: "SAFE_COMMERCIAL", status: "APPROVED", isRecommendedForVisualisation: true },
      { id: "dir-2", designDirectionName: "Oversized Tee", overallScore: 60, commercialClassification: "FASHION_FORWARD", status: "GENERATED", isRecommendedForVisualisation: false },
    ]);
    (AiGarmentGeneratedImageRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([{ decision: "SELECTED" }, { decision: "PENDING" }]);

    const sheet = await getMerchandisingActionSheet("co-1", "proj-1");

    expect(sheet.designDevelopment.designDirections).toEqual({ total: 2, approved: 1, recommended: 1, selected: { id: "dir-1", name: "Classic Crew Tee", overallScore: 85, classification: "SAFE_COMMERCIAL" } });
    expect(sheet.designDevelopment.generatedImages).toEqual({ total: 2, selectedCount: 1 });
    expect(AiGarmentGeneratedImageRepository.findByDesignDirectionId).toHaveBeenCalledWith("dir-1");
  });

  it("reports real BOM approval status and item count once the project has graduated to a Style", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, productId: "style-1" });
    (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({
      bom: { approvedVersionId: "ver-1", approvedVersion: { items: [{ id: "i1" }, { id: "i2" }] } },
    });

    const sheet = await getMerchandisingActionSheet("co-1", "proj-1");

    expect(sheet.costingAndBom.bomApproved).toBe(true);
    expect(sheet.costingAndBom.bomItemCount).toBe(2);
    expect(getBomByProductId).toHaveBeenCalledWith("co-1", "style-1");
  });

  it("does not call getBomByProductId at all when the project hasn't graduated to a Style yet", async () => {
    await getMerchandisingActionSheet("co-1", "proj-1");
    expect(getBomByProductId).not.toHaveBeenCalled();
  });

  it("passes through the real Buyer Comments summary unchanged, or null when none exists yet", async () => {
    (AiGarmentBuyerCommentsRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: "2026-09-08T00:00:00Z",
      overallSummary: "Buyer wants the neckline tightened.",
      categories: [{ category: "FIT", summary: "Neckline gapes." }],
    });
    const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
    expect(sheet.buyerFeedback).toEqual({
      generatedAt: "2026-09-08T00:00:00Z",
      overallSummary: "Buyer wants the neckline tightened.",
      categories: [{ category: "FIT", summary: "Neckline gapes." }],
    });
  });

  describe("pendingActions — purely rule-derived, never AI-proposed", () => {
    it("a terminal COMPLETED project reports no pending actions beyond the terminal note", async () => {
      (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, status: "COMPLETED" });
      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toEqual(["Project complete — no further action needed."]);
    });

    it("a REJECTED project reports only the terminal note", async () => {
      (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, status: "REJECTED" });
      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toEqual(["Project rejected — no further action expected."]);
    });

    it("a brand-new REFERENCE project with nothing done yet asks for Reference Analysis and design directions", async () => {
      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toEqual([
        "Upload a reference image and run Reference Analysis.",
        "Generate design directions.",
      ]);
    });

    it("once directions exist but none are approved, asks to approve one instead of generating more", async () => {
      (AiGarmentReferenceAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "APPROVED" });
      (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "dir-1", status: "GENERATED", isRecommendedForVisualisation: false },
      ]);
      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toEqual(["Approve at least one design direction."]);
    });

    it("once a direction is approved but none selected, asks to compare and select", async () => {
      (AiGarmentReferenceAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "APPROVED" });
      (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "dir-1", status: "APPROVED", isRecommendedForVisualisation: true },
      ]);
      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toEqual(["Compare designs commercially and select one for development."]);
    });

    it("once selected, lists every still-unapproved downstream deliverable for a REFERENCE project", async () => {
      (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...baseProject,
        selectedDesignDirectionId: "dir-1",
      });
      (AiGarmentReferenceAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "APPROVED" });
      (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "dir-1", status: "APPROVED", isRecommendedForVisualisation: true },
      ]);

      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");

      expect(sheet.pendingActions).toEqual([
        "Approve a fabric application onto the selected design.",
        "Approve a Technical Flat for the selected design.",
        "Approve a Technical Specification (measurement chart) for the selected design.",
        "Convert the project to a Style to begin BOM/Costing.",
      ]);
    });

    it("a linked but not-yet-decided Sample Request surfaces its own real status", async () => {
      (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...baseProject,
        selectedDesignDirectionId: "dir-1",
        approvedFabricApplicationId: "fa-1",
        approvedTechnicalFlatId: "tf-1",
        approvedTechnicalSpecificationId: "ts-1",
        productId: "style-1",
        sampleRequestId: "sam-1",
        sampleRequest: { requestNumber: "SAM-2026-00001", status: "SUBMITTED_TO_CUSTOMER" },
      });
      (AiGarmentReferenceAnalysisRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "APPROVED" });
      (AiGarmentDesignDirectionRepository.findByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "dir-1", status: "APPROVED", isRecommendedForVisualisation: true },
      ]);
      (getBomByProductId as ReturnType<typeof vi.fn>).mockResolvedValue({ bom: { approvedVersionId: "ver-1", approvedVersion: { items: [] } } });

      const sheet = await getMerchandisingActionSheet("co-1", "proj-1");

      expect(sheet.pendingActions).toEqual(["Awaiting buyer decision on the linked Sample Request (currently SUBMITTED_TO_CUSTOMER)."]);
    });

    it("once past Sampling Review, asks to link a Sales Order, then to create a Production Order, then to mark complete", async () => {
      (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...baseProject,
        status: "APPROVED",
        completedStepKeys: ["SAMPLING_REVIEW"],
      });
      let sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toContain("Link a Sales Order to the project.");

      (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...baseProject,
        status: "PRODUCTION",
        completedStepKeys: ["SAMPLING_REVIEW"],
        salesOrderId: "so-1",
        salesOrder: { orderNumber: "ORD-2026-00001", status: "CONFIRMED" },
      });
      (getProductionStatusForProject as ReturnType<typeof vi.fn>).mockResolvedValue({ hasSalesOrder: true, hasProductionOrder: false });
      sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toContain("Create a Production Order against the linked Sales Order.");

      (getProductionStatusForProject as ReturnType<typeof vi.fn>).mockResolvedValue({ hasSalesOrder: true, hasProductionOrder: true });
      sheet = await getMerchandisingActionSheet("co-1", "proj-1");
      expect(sheet.pendingActions).toContain("Mark the project workflow complete.");
    });
  });
});

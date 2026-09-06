import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
}));
vi.mock("@/core/ai/reference-analysis/analyze", () => ({
  analyzeReferenceGarment: vi.fn(),
  PROMPT_VERSION: "reference-analysis-v1",
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
  AiGarmentProjectRepository: {
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("./reference-analysis.repository", () => ({
  AiGarmentReferenceAnalysisRepository: {
    findByProjectId: vi.fn(),
    replaceForProject: vi.fn(),
    markStale: vi.fn(),
    approveWithObservations: vi.fn(),
    updateStatus: vi.fn(),
  },
  AiGarmentReferenceObservationRepository: {
    findWithAnalysisOwner: vi.fn(),
    update: vi.fn(),
  },
  AiGarmentReferenceAnalysisRunRepository: {
    findActiveSince: vi.fn(),
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  },
}));

const { uploadAttachment, deleteAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { analyzeReferenceGarment, AiConfigMissingError, AiServiceError, AiInvalidResponseError } = await import(
  "@/core/ai/reference-analysis/analyze"
);
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const {
  AiGarmentReferenceAnalysisRepository,
  AiGarmentReferenceObservationRepository,
  AiGarmentReferenceAnalysisRunRepository,
} = await import("./reference-analysis.repository");
const {
  setReferenceImage,
  deleteReferenceImage,
  runReferenceAnalysis,
  updateObservation,
  resetObservationToAi,
  approveReferenceAnalysis,
} = await import("./reference-analysis.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  status: "DESIGN_DEVELOPMENT",
  referenceImageAttachmentId: null as string | null,
  category: { name: "Shirts" },
  targetMarket: "USA",
};

beforeEach(() => {
  vi.mocked(uploadAttachment).mockReset();
  vi.mocked(deleteAttachment).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAttachmentForDownload).mockReset();
  vi.mocked(analyzeReferenceGarment).mockReset();
  vi.mocked(AiGarmentProjectRepository.findAnyById).mockReset();
  vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockReset();
  vi.mocked(AiGarmentProjectRepository.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockReset();
  vi.mocked(AiGarmentReferenceAnalysisRepository.replaceForProject).mockReset();
  vi.mocked(AiGarmentReferenceAnalysisRepository.markStale).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(AiGarmentReferenceAnalysisRepository.approveWithObservations).mockReset();
  vi.mocked(AiGarmentReferenceAnalysisRepository.updateStatus).mockReset();
  vi.mocked(AiGarmentReferenceObservationRepository.findWithAnalysisOwner).mockReset();
  vi.mocked(AiGarmentReferenceObservationRepository.update).mockReset();
  vi.mocked(AiGarmentReferenceAnalysisRunRepository.findActiveSince).mockReset().mockResolvedValue(null);
  vi.mocked(AiGarmentReferenceAnalysisRunRepository.create).mockReset().mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(AiGarmentReferenceAnalysisRunRepository.markSuccess).mockReset();
  vi.mocked(AiGarmentReferenceAnalysisRunRepository.markFailed).mockReset();
});

describe("setReferenceImage / deleteReferenceImage", () => {
  it("rejects a non-image file even though the shared FileStorage allowlist would accept it", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);

    await expect(
      setReferenceImage(actor, "proj-1", { buffer: Buffer.from(""), fileName: "a.pdf", mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("not supported") });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("marks the existing analysis STALE and deletes the old attachment when replacing an image", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-old",
    } as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);

    await setReferenceImage(actor, "proj-1", { buffer: Buffer.from("x"), fileName: "a.jpg", mimeType: "image/jpeg" });

    expect(AiGarmentReferenceAnalysisRepository.markStale).toHaveBeenCalledWith("proj-1");
    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-old");
    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith("proj-1", { referenceImageAttachmentId: "att-new" });
  });

  it("rejects deleting when no reference image exists", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    await expect(deleteReferenceImage(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("runReferenceAnalysis", () => {
  it("rejects when no reference image has been uploaded", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject as never);

    await expect(runReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "No reference image has been uploaded.",
    });
    expect(analyzeReferenceGarment).not.toHaveBeenCalled();
  });

  it("blocks a duplicate request while a run is already in progress", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-1",
    } as never);
    vi.mocked(AiGarmentReferenceAnalysisRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(runReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentReferenceAnalysisRunRepository.create).not.toHaveBeenCalled();
  });

  it("rejects an attachment whose stored mimeType is not an allowed image format", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "application/pdf" },
      buffer: Buffer.from(""),
    } as never);

    await expect(runReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(analyzeReferenceGarment).mockRejectedValue(new AiConfigMissingError("AI service configuration is missing."));

    await expect(runReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
      message: "AI service configuration is missing.",
    });
    expect(AiGarmentReferenceAnalysisRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", "AI service configuration is missing.");
    expect(AiGarmentReferenceAnalysisRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it("maps a provider timeout to AI_SERVICE_ERROR", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(analyzeReferenceGarment).mockRejectedValue(
      new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT")
    );

    await expect(runReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentReferenceAnalysisRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "TIMEOUT",
      "AI analysis could not be completed. Please try again."
    );
  });

  it("maps an invalid structured response to AI_INVALID_RESPONSE and never saves it as approved analysis", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(analyzeReferenceGarment).mockRejectedValue(new AiInvalidResponseError("AI returned an invalid structured response."));

    await expect(runReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(AiGarmentReferenceAnalysisRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it("persists a full observation set and marks the run SUCCESS on a valid response", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      referenceImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId)
      .mockResolvedValueOnce(null) // pre-check for nextVersion
      .mockResolvedValueOnce({ id: "analysis-1", observations: [] } as never); // final re-read after replace

    const fakeObservation = { observation: "Full sleeve", confidence: "CONFIRMED_VISUALLY", manufacturingRelevance: "Standard." };
    vi.mocked(analyzeReferenceGarment).mockResolvedValue({
      model: "claude-opus-5",
      rawResponse: { fake: true },
      data: {
        garmentCategory: fakeObservation,
        silhouette: fakeObservation,
        garmentLength: fakeObservation,
        fit: fakeObservation,
        neckline: fakeObservation,
        collar: fakeObservation,
        sleeveType: fakeObservation,
        sleeveLength: fakeObservation,
        sleeveVolume: fakeObservation,
        sleeveCuff: fakeObservation,
        shoulderConstruction: fakeObservation,
        frontConstruction: fakeObservation,
        backConstruction: fakeObservation,
        openingClosure: fakeObservation,
        panels: fakeObservation,
        seams: fakeObservation,
        darts: fakeObservation,
        pleats: fakeObservation,
        gathers: fakeObservation,
        tucks: fakeObservation,
        pockets: fakeObservation,
        waistTreatment: fakeObservation,
        hem: fakeObservation,
        trims: fakeObservation,
        decorativeDetails: fakeObservation,
        fabricWeight: fakeObservation,
        fabricDrape: fakeObservation,
        fabricTexture: fakeObservation,
        fabricStretchAppearance: fakeObservation,
        fabricTransparency: fakeObservation,
        fabricSurfaceCharacter: fakeObservation,
        printPatternType: fakeObservation,
        printPatternScale: fakeObservation,
        printPatternDirection: fakeObservation,
        printPatternPlacement: fakeObservation,
        printPatternRepeatAppearance: fakeObservation,
        constructionComplexityLevel: "MEDIUM",
        constructionComplexityExplanation: "Several panels.",
        manufacturingChallenges: ["Pattern matching"],
        keyDesignLanguageFeatures: ["Clean lines"],
        featuresForFurtherDevelopment: ["Collar shape"],
        featuresToChangeForDifferentiation: ["Placket width"],
        missingInformation: ["Back view"],
        designDnaSummary: "A clean, minimal shirt silhouette.",
      },
    } as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.replaceForProject).mockResolvedValue({ id: "analysis-1", analysisVersion: 1 } as never);

    const result = await runReferenceAnalysis(actor, "proj-1");

    expect(AiGarmentReferenceAnalysisRepository.replaceForProject).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ status: "AI_ANALYSED", analysisVersion: 1, model: "claude-opus-5" }),
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "garmentCategory", aiObservation: "Full sleeve", approvedObservation: "Full sleeve" }),
      ])
    );
    // 36 observations: 21 simple top-level + sleeve(4) + fabricObservations(6) + printPattern(5) = 36
    const observationsArg = vi.mocked(AiGarmentReferenceAnalysisRepository.replaceForProject).mock.calls[0][2];
    expect(observationsArg).toHaveLength(36);
    expect(AiGarmentReferenceAnalysisRunRepository.markSuccess).toHaveBeenCalledWith("run-1", "analysis-1");
    expect(result).toEqual({ id: "analysis-1", observations: [] });
  });
});

describe("updateObservation / resetObservationToAi", () => {
  const owned = (overrides = {}) => ({
    id: "obs-1",
    analysisId: "analysis-1",
    aiObservation: "3/4 Sleeve",
    approvedObservation: "3/4 Sleeve",
    userEdited: false,
    analysis: { status: "AI_ANALYSED", project: { companyId: "co-1" } },
    ...overrides,
  });

  it("rejects an observation belonging to another company", async () => {
    vi.mocked(AiGarmentReferenceObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      ...owned(),
      analysis: { status: "AI_ANALYSED", project: { companyId: "other-co" } },
    } as never);

    await expect(updateObservation(actor, "obs-1", "Full Sleeve")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(AiGarmentReferenceObservationRepository.update).not.toHaveBeenCalled();
  });

  it("keeps the AI original observation untouched and stores the correction separately", async () => {
    vi.mocked(AiGarmentReferenceObservationRepository.findWithAnalysisOwner).mockResolvedValue(owned() as never);

    await updateObservation(actor, "obs-1", "Full Sleeve");

    expect(AiGarmentReferenceObservationRepository.update).toHaveBeenCalledWith("obs-1", {
      approvedObservation: "Full Sleeve",
      userEdited: true,
    });
    // aiObservation is never part of the update payload — it's structurally impossible to overwrite here.
  });

  it("bumps a fresh AI_ANALYSED analysis to UNDER_REVIEW on first edit", async () => {
    vi.mocked(AiGarmentReferenceObservationRepository.findWithAnalysisOwner).mockResolvedValue(owned() as never);
    await updateObservation(actor, "obs-1", "Full Sleeve");
    expect(AiGarmentReferenceAnalysisRepository.updateStatus).toHaveBeenCalledWith("analysis-1", "UNDER_REVIEW");
  });

  it("blocks editing an observation on a STALE analysis", async () => {
    vi.mocked(AiGarmentReferenceObservationRepository.findWithAnalysisOwner).mockResolvedValue(
      owned({ analysis: { status: "STALE", project: { companyId: "co-1" } } }) as never
    );

    await expect(updateObservation(actor, "obs-1", "Full Sleeve")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentReferenceObservationRepository.update).not.toHaveBeenCalled();
  });

  it("restores the AI observation and clears userEdited on reset", async () => {
    vi.mocked(AiGarmentReferenceObservationRepository.findWithAnalysisOwner).mockResolvedValue(
      owned({ approvedObservation: "Full Sleeve", userEdited: true }) as never
    );

    await resetObservationToAi(actor, "obs-1");

    expect(AiGarmentReferenceObservationRepository.update).toHaveBeenCalledWith("obs-1", {
      approvedObservation: "3/4 Sleeve",
      userEdited: false,
    });
  });
});

describe("approveReferenceAnalysis", () => {
  it("rejects approving when no analysis exists yet", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);

    await expect(approveReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects approving a STALE analysis", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "STALE" } as never);

    await expect(approveReferenceAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentReferenceAnalysisRepository.approveWithObservations).not.toHaveBeenCalled();
  });

  it("bulk-stamps approval on both the header and every observation", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "UNDER_REVIEW" } as never);
    vi.mocked(AiGarmentReferenceAnalysisRepository.approveWithObservations).mockResolvedValue({ id: "analysis-1", status: "APPROVED" } as never);

    await approveReferenceAnalysis(actor, "proj-1");

    expect(AiGarmentReferenceAnalysisRepository.approveWithObservations).toHaveBeenCalledWith("analysis-1", "user-1");
  });
});

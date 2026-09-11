import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
}));
vi.mock("@/core/ai/fabric-analysis/analyze", () => ({
  analyzeFabricSwatch: vi.fn(),
  PROMPT_VERSION: "fabric-analysis-v1",
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
vi.mock("./fabric-analysis.repository", () => ({
  AiGarmentFabricAnalysisRepository: {
    findByProjectId: vi.fn(),
    replaceForProject: vi.fn(),
    markStale: vi.fn(),
    approveWithObservations: vi.fn(),
    updateStatus: vi.fn(),
  },
  AiGarmentFabricObservationRepository: {
    findWithAnalysisOwner: vi.fn(),
    update: vi.fn(),
  },
  AiGarmentFabricAnalysisRunRepository: {
    findActiveSince: vi.fn(),
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  },
}));

const { uploadAttachment, deleteAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { analyzeFabricSwatch, AiConfigMissingError, AiServiceError, AiInvalidResponseError } = await import(
  "@/core/ai/fabric-analysis/analyze"
);
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentFabricAnalysisRepository, AiGarmentFabricObservationRepository, AiGarmentFabricAnalysisRunRepository } =
  await import("./fabric-analysis.repository");
const {
  setFabricSwatchImage,
  deleteFabricSwatchImage,
  runFabricAnalysis,
  updateFabricObservation,
  resetFabricObservationToAi,
  approveFabricAnalysis,
} = await import("./fabric-analysis.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  status: "DESIGN_DEVELOPMENT",
  fabricSwatchImageAttachmentId: null as string | null,
  category: { name: "Shirts" },
  targetMarket: "USA",
};

beforeEach(() => {
  vi.mocked(uploadAttachment).mockReset();
  vi.mocked(deleteAttachment).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAttachmentForDownload).mockReset();
  vi.mocked(analyzeFabricSwatch).mockReset();
  vi.mocked(AiGarmentProjectRepository.findAnyById).mockReset();
  vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockReset();
  vi.mocked(AiGarmentProjectRepository.update).mockReset().mockResolvedValue({} as never);
  vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockReset();
  vi.mocked(AiGarmentFabricAnalysisRepository.replaceForProject).mockReset();
  vi.mocked(AiGarmentFabricAnalysisRepository.markStale).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(AiGarmentFabricAnalysisRepository.approveWithObservations).mockReset();
  vi.mocked(AiGarmentFabricAnalysisRepository.updateStatus).mockReset();
  vi.mocked(AiGarmentFabricObservationRepository.findWithAnalysisOwner).mockReset();
  vi.mocked(AiGarmentFabricObservationRepository.update).mockReset();
  vi.mocked(AiGarmentFabricAnalysisRunRepository.findActiveSince).mockReset().mockResolvedValue(null);
  vi.mocked(AiGarmentFabricAnalysisRunRepository.create).mockReset().mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(AiGarmentFabricAnalysisRunRepository.markSuccess).mockReset();
  vi.mocked(AiGarmentFabricAnalysisRunRepository.markFailed).mockReset();
});

describe("setFabricSwatchImage / deleteFabricSwatchImage", () => {
  it("rejects a non-image file even though the shared FileStorage allowlist would accept it", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);

    await expect(
      setFabricSwatchImage(actor, "proj-1", { buffer: Buffer.from(""), fileName: "a.pdf", mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("not supported") });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("marks the existing analysis STALE and deletes the old attachment when replacing an image", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-old",
    } as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);

    await setFabricSwatchImage(actor, "proj-1", { buffer: Buffer.from("x"), fileName: "a.jpg", mimeType: "image/jpeg" });

    expect(AiGarmentFabricAnalysisRepository.markStale).toHaveBeenCalledWith("proj-1");
    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-old");
    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith("proj-1", { fabricSwatchImageAttachmentId: "att-new" });
  });

  it("rejects deleting when no fabric swatch image exists", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    await expect(deleteFabricSwatchImage(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("runFabricAnalysis", () => {
  it("rejects when no fabric swatch image has been uploaded", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject as never);

    await expect(runFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "No fabric swatch image has been uploaded.",
    });
    expect(analyzeFabricSwatch).not.toHaveBeenCalled();
  });

  it("blocks a duplicate request while a run is already in progress", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-1",
    } as never);
    vi.mocked(AiGarmentFabricAnalysisRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(runFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentFabricAnalysisRunRepository.create).not.toHaveBeenCalled();
  });

  it("rejects an attachment whose stored mimeType is not an allowed image format", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "application/pdf" },
      buffer: Buffer.from(""),
    } as never);

    await expect(runFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(analyzeFabricSwatch).mockRejectedValue(new AiConfigMissingError("AI service configuration is missing."));

    await expect(runFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
      message: "AI service configuration is missing.",
    });
    expect(AiGarmentFabricAnalysisRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "MISSING_CONFIG",
      "AI service configuration is missing."
    );
    expect(AiGarmentFabricAnalysisRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it("maps a provider timeout to AI_SERVICE_ERROR", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(analyzeFabricSwatch).mockRejectedValue(
      new AiServiceError("AI analysis could not be completed. Please try again.", "TIMEOUT")
    );

    await expect(runFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentFabricAnalysisRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "TIMEOUT",
      "AI analysis could not be completed. Please try again."
    );
  });

  it("maps an invalid structured response to AI_INVALID_RESPONSE and never saves it as approved analysis", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue(null);
    vi.mocked(analyzeFabricSwatch).mockRejectedValue(new AiInvalidResponseError("AI returned an invalid structured response."));

    await expect(runFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" });
    expect(AiGarmentFabricAnalysisRepository.replaceForProject).not.toHaveBeenCalled();
  });

  it("persists a full 13-observation set and marks the run SUCCESS on a valid response", async () => {
    vi.mocked(AiGarmentProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...baseProject,
      fabricSwatchImageAttachmentId: "att-1",
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("x"),
    } as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId)
      .mockResolvedValueOnce(null) // pre-check for nextVersion
      .mockResolvedValueOnce({ id: "analysis-1", observations: [] } as never); // final re-read after replace

    const fakeObservation = { observation: "Single jersey knit", confidence: "CONFIRMED_VISUALLY", manufacturingRelevance: "Standard." };
    vi.mocked(analyzeFabricSwatch).mockResolvedValue({
      model: "claude-opus-5",
      rawResponse: { fake: true },
      data: {
        fabricType: fakeObservation,
        weaveOrKnitStructure: fakeObservation,
        estimatedComposition: fakeObservation,
        estimatedGsmClass: fakeObservation,
        directionality: fakeObservation,
        colorDescription: fakeObservation,
        patternOrPrint: fakeObservation,
        surfaceTexture: fakeObservation,
        sheenOrLuster: fakeObservation,
        transparencyLevel: fakeObservation,
        estimatedStretch: fakeObservation,
        estimatedDrape: fakeObservation,
        estimatedRecovery: fakeObservation,
        missingInformation: ["Exact GSM"],
        fabricSummary: "A medium-weight cotton-blend single jersey knit.",
      },
    } as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.replaceForProject).mockResolvedValue({ id: "analysis-1", analysisVersion: 1 } as never);

    const result = await runFabricAnalysis(actor, "proj-1");

    expect(AiGarmentFabricAnalysisRepository.replaceForProject).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ status: "AI_ANALYSED", analysisVersion: 1, model: "claude-opus-5" }),
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "fabricType", aiObservation: "Single jersey knit", approvedObservation: "Single jersey knit" }),
      ])
    );
    const observationsArg = vi.mocked(AiGarmentFabricAnalysisRepository.replaceForProject).mock.calls[0][2];
    expect(observationsArg).toHaveLength(13);
    expect(AiGarmentFabricAnalysisRunRepository.markSuccess).toHaveBeenCalledWith("run-1", "analysis-1");
    expect(result).toEqual({ id: "analysis-1", observations: [] });
  });
});

describe("updateFabricObservation / resetFabricObservationToAi", () => {
  const owned = (overrides = {}) => ({
    id: "obs-1",
    analysisId: "analysis-1",
    aiObservation: "Plain weave",
    approvedObservation: "Plain weave",
    userEdited: false,
    analysis: { status: "AI_ANALYSED", project: { companyId: "co-1" } },
    ...overrides,
  });

  it("rejects an observation belonging to another company", async () => {
    vi.mocked(AiGarmentFabricObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      ...owned(),
      analysis: { status: "AI_ANALYSED", project: { companyId: "other-co" } },
    } as never);

    await expect(updateFabricObservation(actor, "obs-1", "Twill weave")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(AiGarmentFabricObservationRepository.update).not.toHaveBeenCalled();
  });

  it("keeps the AI original observation untouched and stores the correction separately", async () => {
    vi.mocked(AiGarmentFabricObservationRepository.findWithAnalysisOwner).mockResolvedValue(owned() as never);

    await updateFabricObservation(actor, "obs-1", "Twill weave");

    expect(AiGarmentFabricObservationRepository.update).toHaveBeenCalledWith("obs-1", {
      approvedObservation: "Twill weave",
      userEdited: true,
    });
  });

  it("bumps a fresh AI_ANALYSED analysis to UNDER_REVIEW on first edit", async () => {
    vi.mocked(AiGarmentFabricObservationRepository.findWithAnalysisOwner).mockResolvedValue(owned() as never);
    await updateFabricObservation(actor, "obs-1", "Twill weave");
    expect(AiGarmentFabricAnalysisRepository.updateStatus).toHaveBeenCalledWith("analysis-1", "UNDER_REVIEW");
  });

  it("blocks editing an observation on a STALE analysis", async () => {
    vi.mocked(AiGarmentFabricObservationRepository.findWithAnalysisOwner).mockResolvedValue(
      owned({ analysis: { status: "STALE", project: { companyId: "co-1" } } }) as never
    );

    await expect(updateFabricObservation(actor, "obs-1", "Twill weave")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentFabricObservationRepository.update).not.toHaveBeenCalled();
  });

  it("restores the AI observation and clears userEdited on reset", async () => {
    vi.mocked(AiGarmentFabricObservationRepository.findWithAnalysisOwner).mockResolvedValue(
      owned({ approvedObservation: "Twill weave", userEdited: true }) as never
    );

    await resetFabricObservationToAi(actor, "obs-1");

    expect(AiGarmentFabricObservationRepository.update).toHaveBeenCalledWith("obs-1", {
      approvedObservation: "Plain weave",
      userEdited: false,
    });
  });
});

describe("approveFabricAnalysis", () => {
  it("rejects approving when no analysis exists yet", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue(null);

    await expect(approveFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects approving a STALE analysis", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "STALE" } as never);

    await expect(approveFabricAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiGarmentFabricAnalysisRepository.approveWithObservations).not.toHaveBeenCalled();
  });

  it("bulk-stamps approval on both the header and every observation", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(baseProject as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "UNDER_REVIEW" } as never);
    vi.mocked(AiGarmentFabricAnalysisRepository.approveWithObservations).mockResolvedValue({ id: "analysis-1", status: "APPROVED" } as never);

    await approveFabricAnalysis(actor, "proj-1");

    expect(AiGarmentFabricAnalysisRepository.approveWithObservations).toHaveBeenCalledWith("analysis-1", "user-1");
  });
});

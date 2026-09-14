import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
  deleteAttachment: vi.fn(),
}));
vi.mock("@/core/ai-designer/replicate-design/dna-analysis/analyze", () => ({
  analyzeReplicateDesignDna: vi.fn(),
}));
vi.mock("@/core/ai-designer/replicate-design/compatibility-check/generate", () => ({
  generateCompatibilityCheck: vi.fn(),
}));
vi.mock("@/core/ai/provider-manager/AIProviderManager", () => ({ runWithFailover: vi.fn() }));
vi.mock("@/core/ai-designer/replicate-design/tech-pack/generate", () => ({
  generateGarmentAnalysisPart1: vi.fn(),
  generateGarmentAnalysisPart2: vi.fn(),
  generatePagePrompts: vi.fn(),
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn() },
}));
vi.mock("./replicate-design.repository", () => ({
  ReplicateDesignProjectRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  ReplicateDesignDnaAnalysisRepository: {
    findByProjectId: vi.fn(),
    upsertWithObservations: vi.fn(),
    markStale: vi.fn(),
    update: vi.fn(),
    approveAllObservations: vi.fn(),
  },
  ReplicateDesignDnaObservationRepository: {
    findWithAnalysisOwner: vi.fn(),
    update: vi.fn(),
  },
  ReplicateDesignDnaAnalysisRunRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findActiveSince: vi.fn(),
  },
  ReplicateDesignMaterialLineRepository: {
    findByProjectId: vi.fn(),
    findAnyById: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  ReplicateDesignCompatibilityRepository: {
    findByProjectId: vi.fn(),
    upsertWithItems: vi.fn(),
  },
  ReplicateDesignCompatibilityRunRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findActiveSince: vi.fn(),
  },
  ReplicateDesignPromptRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markSuccessWithProvider: vi.fn(),
    markFailed: vi.fn(),
    findActiveSince: vi.fn(),
  },
  ReplicateDesignGenerationRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findByIdWithPrompt: vi.fn(),
  },
  ReplicateDesignImageRepository: {
    createMany: vi.fn(),
    findByGenerationId: vi.fn(),
    findByProjectId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    update: vi.fn(),
  },
  ReplicateDesignVersionRepository: {
    create: vi.fn(),
    findByProjectId: vi.fn(),
    count: vi.fn(),
    updateApprovalStatus: vi.fn(),
  },
  ReplicateDesignTechPackRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findLatestByProjectId: vi.fn(),
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { uploadAttachment, getAttachmentForDownload, deleteAttachment } = await import("@/core/attachments/AttachmentService");
const { analyzeReplicateDesignDna } = await import("@/core/ai-designer/replicate-design/dna-analysis/analyze");
const { generateCompatibilityCheck } = await import("@/core/ai-designer/replicate-design/compatibility-check/generate");
const { runWithFailover } = await import("@/core/ai/provider-manager/AIProviderManager");
const { generateGarmentAnalysisPart1, generateGarmentAnalysisPart2, generatePagePrompts } = await import("@/core/ai-designer/replicate-design/tech-pack/generate");
const { ProductRepository } = await import("@/modules/products/product.repository");
const {
  ReplicateDesignProjectRepository,
  ReplicateDesignDnaAnalysisRepository,
  ReplicateDesignDnaObservationRepository,
  ReplicateDesignDnaAnalysisRunRepository,
  ReplicateDesignMaterialLineRepository,
  ReplicateDesignCompatibilityRepository,
  ReplicateDesignCompatibilityRunRepository,
  ReplicateDesignPromptRepository,
  ReplicateDesignGenerationRepository,
  ReplicateDesignImageRepository,
  ReplicateDesignVersionRepository,
  ReplicateDesignTechPackRepository,
} = await import("./replicate-design.repository");
const {
  createReplicateProject,
  uploadReferenceImage,
  runDnaAnalysis,
  updateDnaObservation,
  resetDnaObservationToAi,
  setDnaObservationLock,
  approveDnaAnalysis,
  selectReplicateFabric,
  addMaterialLine,
  removeMaterialLine,
  runCompatibilityCheck,
  generateReplicatedDesign,
  decideReplicateImage,
  generateReplicateEditPreview,
  applyReplicateEditVariation,
  approveReplicateVersion,
  rejectReplicateVersion,
  generateReplicateTechPack,
  getLatestReplicateTechPack,
} = await import("./replicate-design.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    companyId: "co-1",
    projectNumber: "RPD-2026-00001",
    projectName: "Test Project",
    status: "DRAFT",
    currentStep: "REFERENCE_UPLOAD",
    completedSteps: [] as string[],
    referenceFrontImageAttachmentId: null,
    referenceBackImageAttachmentId: null,
    referenceSideImageAttachmentId: null,
    referenceDetailImageAttachmentId: null,
    fabricSource: null,
    fabricProductId: null,
    fabricImageAttachmentId: null,
    fabricName: null,
    fabricCode: null,
    fabricSupplierId: null,
    currentVersionId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("RPD-2026-00001");
  vi.mocked(ReplicateDesignProjectRepository.create).mockReset();
  vi.mocked(ReplicateDesignProjectRepository.update)
    .mockReset()
    .mockImplementation(((_id: string, data: Record<string, unknown>) => Promise.resolve({ ...data })) as never);
  vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockReset();
  vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockReset();
  vi.mocked(ProductRepository.findMaterialById).mockReset();

  vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockReset();
  vi.mocked(ReplicateDesignDnaAnalysisRepository.upsertWithObservations).mockReset();
  vi.mocked(ReplicateDesignDnaAnalysisRepository.markStale).mockReset();
  vi.mocked(ReplicateDesignDnaAnalysisRepository.update).mockReset();
  vi.mocked(ReplicateDesignDnaAnalysisRepository.approveAllObservations).mockReset();

  vi.mocked(ReplicateDesignDnaObservationRepository.findWithAnalysisOwner).mockReset();
  vi.mocked(ReplicateDesignDnaObservationRepository.update).mockReset();

  vi.mocked(ReplicateDesignDnaAnalysisRunRepository.create).mockReset().mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(ReplicateDesignDnaAnalysisRunRepository.markSuccess).mockReset();
  vi.mocked(ReplicateDesignDnaAnalysisRunRepository.markFailed).mockReset();
  vi.mocked(ReplicateDesignDnaAnalysisRunRepository.findActiveSince).mockReset().mockResolvedValue(null);

  vi.mocked(ReplicateDesignMaterialLineRepository.findByProjectId).mockReset().mockResolvedValue([]);
  vi.mocked(ReplicateDesignMaterialLineRepository.findAnyById).mockReset();
  vi.mocked(ReplicateDesignMaterialLineRepository.create).mockReset();
  vi.mocked(ReplicateDesignMaterialLineRepository.delete).mockReset();

  vi.mocked(ReplicateDesignCompatibilityRepository.findByProjectId).mockReset();
  vi.mocked(ReplicateDesignCompatibilityRepository.upsertWithItems).mockReset();

  vi.mocked(ReplicateDesignCompatibilityRunRepository.create).mockReset().mockResolvedValue({ id: "compat-run-1" } as never);
  vi.mocked(ReplicateDesignCompatibilityRunRepository.markSuccess).mockReset();
  vi.mocked(ReplicateDesignCompatibilityRunRepository.markFailed).mockReset();
  vi.mocked(ReplicateDesignCompatibilityRunRepository.findActiveSince).mockReset().mockResolvedValue(null);

  vi.mocked(ReplicateDesignPromptRepository.create).mockReset().mockResolvedValue({ id: "prompt-1" } as never);
  vi.mocked(ReplicateDesignPromptRepository.markSuccess).mockReset();
  vi.mocked(ReplicateDesignPromptRepository.markSuccessWithProvider).mockReset();
  vi.mocked(ReplicateDesignPromptRepository.markFailed).mockReset();
  vi.mocked(ReplicateDesignPromptRepository.findActiveSince).mockReset().mockResolvedValue(null);

  vi.mocked(ReplicateDesignGenerationRepository.create).mockReset().mockResolvedValue({ id: "gen-1" } as never);
  vi.mocked(ReplicateDesignGenerationRepository.markSuccess).mockReset();
  vi.mocked(ReplicateDesignGenerationRepository.markFailed).mockReset();

  vi.mocked(ReplicateDesignImageRepository.createMany).mockReset();
  vi.mocked(ReplicateDesignImageRepository.findByGenerationId).mockReset().mockResolvedValue([]);
  vi.mocked(ReplicateDesignImageRepository.findByProjectId).mockReset();
  vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockReset();
  vi.mocked(ReplicateDesignImageRepository.update).mockReset();

  vi.mocked(ReplicateDesignVersionRepository.create).mockReset().mockResolvedValue({ id: "version-1", versionNumber: 1 } as never);
  vi.mocked(ReplicateDesignVersionRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(ReplicateDesignVersionRepository.findByProjectId).mockReset();
  vi.mocked(ReplicateDesignVersionRepository.updateApprovalStatus).mockReset();

  vi.mocked(ReplicateDesignGenerationRepository.findByIdWithPrompt).mockReset();

  vi.mocked(ReplicateDesignTechPackRepository.create).mockReset().mockResolvedValue({ id: "techpack-1" } as never);
  vi.mocked(ReplicateDesignTechPackRepository.markSuccess).mockReset();
  vi.mocked(ReplicateDesignTechPackRepository.markFailed).mockReset();
  vi.mocked(ReplicateDesignTechPackRepository.findLatestByProjectId).mockReset();
  vi.mocked(generateGarmentAnalysisPart1).mockReset();
  vi.mocked(generateGarmentAnalysisPart2).mockReset();
  vi.mocked(generatePagePrompts).mockReset();

  vi.mocked(uploadAttachment).mockReset().mockResolvedValue({ id: "attachment-1" } as never);
  vi.mocked(getAttachmentForDownload).mockReset();
  vi.mocked(deleteAttachment).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(analyzeReplicateDesignDna).mockReset();
  vi.mocked(generateCompatibilityCheck).mockReset();
  vi.mocked(runWithFailover).mockReset();
});

describe("createReplicateProject", () => {
  it("creates a DRAFT project with a real document number", async () => {
    vi.mocked(ReplicateDesignProjectRepository.create).mockResolvedValue(baseProject({ id: "proj-1" }) as never);

    const project = await createReplicateProject(actor, { projectName: "Replicate My Sample" });

    expect(project.id).toBe("proj-1");
    expect(ReplicateDesignProjectRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "Replicate My Sample", status: "DRAFT", currentStep: "REFERENCE_UPLOAD" })
    );
  });
});

describe("uploadReferenceImage", () => {
  it("rejects an unowned/nonexistent project", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(null);

    await expect(
      uploadReferenceImage(actor, "proj-x", "FRONT", { buffer: Buffer.from("x"), fileName: "f.jpg", mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an unsupported file type", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);

    await expect(
      uploadReferenceImage(actor, "proj-1", "FRONT", { buffer: Buffer.from("x"), fileName: "f.pdf", mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("sets the FRONT slot column and marks any existing DNA analysis stale", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-front" } as never);

    await uploadReferenceImage(actor, "proj-1", "FRONT", { buffer: Buffer.from("x"), fileName: "f.jpg", mimeType: "image/jpeg" });

    const [, data] = vi.mocked(ReplicateDesignProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({ referenceFrontImageAttachmentId: "att-front", completedSteps: ["REFERENCE_UPLOAD"] });
    expect(ReplicateDesignDnaAnalysisRepository.markStale).toHaveBeenCalledWith("proj-1");
  });

  it("does NOT mark the DNA analysis stale when only a BACK/SIDE/DETAIL photo changes", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-back" } as never);

    await uploadReferenceImage(actor, "proj-1", "BACK", { buffer: Buffer.from("x"), fileName: "f.jpg", mimeType: "image/jpeg" });

    expect(ReplicateDesignDnaAnalysisRepository.markStale).not.toHaveBeenCalled();
  });

  it("deletes the previous attachment when replacing a slot that already had one", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-old" }) as never
    );
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);

    await uploadReferenceImage(actor, "proj-1", "FRONT", { buffer: Buffer.from("x"), fileName: "f.jpg", mimeType: "image/jpeg" });

    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-old");
  });
});

describe("runDnaAnalysis", () => {
  it("requires a front reference image before running", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);

    await expect(runDnaAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("blocks a second concurrent run while one is already in progress", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-front" }) as never
    );
    vi.mocked(ReplicateDesignDnaAnalysisRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(runDnaAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("analyzes, persists observations seeded locked and equal to the AI's own text, and advances the step", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-front" }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: Buffer.from("photo"),
    } as never);
    vi.mocked(analyzeReplicateDesignDna).mockResolvedValue({
      data: {
        garmentCategory: { observation: "Dress", confidence: "CONFIRMED_VISUALLY" },
        silhouette: { observation: "A-line", confidence: "CONFIRMED_VISUALLY" },
        garmentLength: { observation: "Knee", confidence: "CONFIRMED_VISUALLY" },
        fit: { observation: "Regular", confidence: "CONFIRMED_VISUALLY" },
        neckline: { observation: "V-neck", confidence: "CONFIRMED_VISUALLY" },
        collar: { observation: "None", confidence: "CONFIRMED_VISUALLY" },
        sleeveType: { observation: "Cap", confidence: "CONFIRMED_VISUALLY" },
        sleeveLength: { observation: "Short", confidence: "CONFIRMED_VISUALLY" },
        shoulderConstruction: { observation: "Set-in", confidence: "LIKELY_INFERRED" },
        closureType: { observation: "Back zip", confidence: "LIKELY_INFERRED" },
        panelsAndSeams: { observation: "Princess seams", confidence: "LIKELY_INFERRED" },
        waistTreatment: { observation: "Fitted", confidence: "LIKELY_INFERRED" },
        hemFinish: { observation: "Plain", confidence: "CONFIRMED_VISUALLY" },
        keyConstructionDetails: { observation: "None notable", confidence: "NOT_DETERMINABLE" },
        designDnaSummary: "A knee-length A-line dress with a V-neck and cap sleeves.",
      },
      model: "claude-opus-5",
      rawResponse: {},
    } as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.upsertWithObservations).mockResolvedValue({ id: "analysis-1" } as never);

    const analysis = await runDnaAnalysis(actor, "proj-1");

    expect(analysis).toMatchObject({ id: "analysis-1" });
    const [, , observations] = vi.mocked(ReplicateDesignDnaAnalysisRepository.upsertWithObservations).mock.calls[0];
    expect(observations.length).toBe(14);
    expect(observations[0]).toMatchObject({ featureKey: "garmentCategory", aiObservation: "Dress", approvedObservation: "Dress", isLocked: true, userEdited: false });
    expect(ReplicateDesignDnaAnalysisRunRepository.markSuccess).toHaveBeenCalledWith("run-1", "analysis-1");
    const [, data] = vi.mocked(ReplicateDesignProjectRepository.update).mock.calls.find(([, d]) => (d as Record<string, unknown>).completedSteps)!;
    expect(data).toMatchObject({ completedSteps: ["DNA_ANALYSIS"] });
  });

  it("marks the run failed and maps an AI failure to a clean AI_SERVICE_ERROR", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-front" }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/jpeg" }, buffer: Buffer.from("x") } as never);
    const { AiInvalidResponseError } = await import("@/core/ai/providers/anthropic");
    vi.mocked(analyzeReplicateDesignDna).mockRejectedValue(new AiInvalidResponseError("bad response"));

    await expect(runDnaAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(ReplicateDesignDnaAnalysisRunRepository.markFailed).toHaveBeenCalledWith("run-1", "NO_STRUCTURED_RESPONSE", "bad response");
  });
});

describe("updateDnaObservation / resetDnaObservationToAi / setDnaObservationLock", () => {
  it("rejects an observation belonging to a different company", async () => {
    vi.mocked(ReplicateDesignDnaObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysisId: "analysis-1",
      analysis: { companyId: "other-co" },
    } as never);

    await expect(updateDnaObservation(actor, "obs-1", { approvedObservation: "New text" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("edits the approved value and pushes an already-APPROVED analysis back to UNDER_REVIEW", async () => {
    vi.mocked(ReplicateDesignDnaObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysisId: "analysis-1",
      approvedObservation: "Old text",
      analysis: { companyId: "co-1", status: "APPROVED" },
    } as never);
    vi.mocked(ReplicateDesignDnaObservationRepository.update).mockResolvedValue({ id: "obs-1" } as never);

    await updateDnaObservation(actor, "obs-1", { approvedObservation: "New text" });

    expect(ReplicateDesignDnaObservationRepository.update).toHaveBeenCalledWith("obs-1", { approvedObservation: "New text", userEdited: true });
    expect(ReplicateDesignDnaAnalysisRepository.update).toHaveBeenCalledWith("analysis-1", { status: "UNDER_REVIEW" });
  });

  it("does not reapprove-reset an analysis that isn't currently APPROVED", async () => {
    vi.mocked(ReplicateDesignDnaObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysisId: "analysis-1",
      approvedObservation: "Old text",
      analysis: { companyId: "co-1", status: "AI_ANALYSED" },
    } as never);
    vi.mocked(ReplicateDesignDnaObservationRepository.update).mockResolvedValue({ id: "obs-1" } as never);

    await updateDnaObservation(actor, "obs-1", { approvedObservation: "New text" });

    expect(ReplicateDesignDnaAnalysisRepository.update).not.toHaveBeenCalled();
  });

  it("resets an observation back to the AI's own original text", async () => {
    vi.mocked(ReplicateDesignDnaObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      aiObservation: "AI original",
      analysis: { companyId: "co-1" },
    } as never);

    await resetDnaObservationToAi(actor, "obs-1");

    expect(ReplicateDesignDnaObservationRepository.update).toHaveBeenCalledWith("obs-1", { approvedObservation: "AI original", userEdited: false });
  });

  it("toggles the lock with no re-approval side effect", async () => {
    vi.mocked(ReplicateDesignDnaObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysis: { companyId: "co-1", status: "APPROVED" },
    } as never);

    await setDnaObservationLock(actor, "obs-1", { isLocked: false });

    expect(ReplicateDesignDnaObservationRepository.update).toHaveBeenCalledWith("obs-1", { isLocked: false });
    expect(ReplicateDesignDnaAnalysisRepository.update).not.toHaveBeenCalled();
  });
});

describe("approveDnaAnalysis", () => {
  it("rejects when the project has no analysis yet", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue(null);

    await expect(approveDnaAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects approving an analysis that's already STALE", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "STALE" } as never);

    await expect(approveDnaAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("bulk-approves the analysis and every observation, advancing the step", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId)
      .mockResolvedValueOnce({ id: "analysis-1", status: "AI_ANALYSED" } as never)
      .mockResolvedValueOnce({ id: "analysis-1", status: "APPROVED" } as never);

    const result = await approveDnaAnalysis(actor, "proj-1");

    expect(ReplicateDesignDnaAnalysisRepository.approveAllObservations).toHaveBeenCalledWith("analysis-1", "user-1");
    expect(result).toMatchObject({ status: "APPROVED" });
    const [, data] = vi.mocked(ReplicateDesignProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({ completedSteps: ["DESIGN_LOCK_REVIEW"] });
  });
});

describe("selectReplicateFabric / addMaterialLine / removeMaterialLine", () => {
  it("rejects a fabric id that isn't a real raw material in this company", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);

    await expect(selectReplicateFabric(actor, "proj-1", { fabricProductId: "mat-x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("auto-fills Name/Code/Supplier from the real Fabric Master", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "mat-1",
      styleName: "Cotton Fabric",
      styleCode: "MAT-00001",
      defaultSupplierId: "sup-1",
    } as never);

    await selectReplicateFabric(actor, "proj-1", { fabricProductId: "mat-1" });

    const [, data] = vi.mocked(ReplicateDesignProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({ fabricSource: "EXISTING", fabricProductId: "mat-1", fabricName: "Cotton Fabric", fabricCode: "MAT-00001" });
  });

  it("rejects a material id that isn't a real raw material in this company", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);

    await expect(addMaterialLine(actor, "proj-1", { productId: "mat-x", role: "OTHER" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects removing a material line that doesn't belong to this company", async () => {
    vi.mocked(ReplicateDesignMaterialLineRepository.findAnyById).mockResolvedValue(null);

    await expect(removeMaterialLine(actor, "line-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("runCompatibilityCheck", () => {
  it("requires the Design DNA analysis to be APPROVED first", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "AI_ANALYSED" } as never);

    await expect(runCompatibilityCheck(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires at least a fabric or a material line", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({
      id: "analysis-1",
      status: "APPROVED",
      designDnaSummary: "Summary",
      observations: [],
    } as never);
    vi.mocked(ReplicateDesignMaterialLineRepository.findByProjectId).mockResolvedValue([]);

    await expect(runCompatibilityCheck(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("never hard-blocks on a non-COMPATIBLE rating — it just persists the warning", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject({ fabricName: "Chiffon" }) as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({
      id: "analysis-1",
      status: "APPROVED",
      designDnaSummary: "A structured blazer.",
      observations: [{ isLocked: true, featureKey: "silhouette", approvedObservation: "Structured" }],
    } as never);
    vi.mocked(ReplicateDesignMaterialLineRepository.findByProjectId).mockResolvedValue([]);
    vi.mocked(generateCompatibilityCheck).mockResolvedValue({
      items: [{ rating: "INCOMPATIBLE", reasoning: "Chiffon cannot hold a structured blazer shape." }],
      overallSummary: "The fabric is unsuitable for this silhouette.",
      overallRating: "INCOMPATIBLE",
      model: "claude-sonnet-5",
      rawResponse: {},
    } as never);
    vi.mocked(ReplicateDesignCompatibilityRepository.upsertWithItems).mockResolvedValue({
      id: "check-1",
      overallRating: "INCOMPATIBLE",
    } as never);

    const check = await runCompatibilityCheck(actor, "proj-1");

    expect(check).toMatchObject({ overallRating: "INCOMPATIBLE" });
    expect(ReplicateDesignCompatibilityRunRepository.markSuccess).toHaveBeenCalled();
  });
});

describe("generateReplicatedDesign", () => {
  it("lists every missing prerequisite instead of stopping at the first one", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue(null);

    await expect(generateReplicatedDesign(actor, "proj-1", { imageCount: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires an explicit acknowledgement when the compatibility check flagged a concern", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-front", fabricImageAttachmentId: "att-fabric" }) as never
    );
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({ id: "analysis-1", status: "APPROVED", observations: [] } as never);
    vi.mocked(ReplicateDesignCompatibilityRepository.findByProjectId).mockResolvedValue({ id: "check-1", overallRating: "MINOR_CONCERN" } as never);

    await expect(generateReplicatedDesign(actor, "proj-1", { imageCount: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("proceeds once the warning is acknowledged, calling the provider's replicateWithNewMaterial", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-front", fabricImageAttachmentId: "att-fabric", fabricName: "Cotton" }) as never
    );
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({
      id: "analysis-1",
      status: "APPROVED",
      observations: [{ featureKey: "silhouette", approvedObservation: "A-line", isLocked: true }],
    } as never);
    vi.mocked(ReplicateDesignCompatibilityRepository.findByProjectId).mockResolvedValue({ id: "check-1", overallRating: "MINOR_CONCERN", overallSummary: "s" } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/jpeg" }, buffer: Buffer.from("x") } as never);
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const provider = { name: "test-provider", replicateWithNewMaterial: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("img"), mimeType: "image/png" }] }) };
      const result = await params.call(provider);
      return { ...(result as object), providerName: "test-provider", model: "test-model" };
    }) as never);
    vi.mocked(ReplicateDesignImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }] as never);

    const result = await generateReplicatedDesign(actor, "proj-1", { imageCount: 1, acknowledgeCompatibilityWarning: true });

    expect(result.images).toMatchObject([{ id: "img-1" }]);
    expect(ReplicateDesignGenerationRepository.markSuccess).toHaveBeenCalled();
    expect(ReplicateDesignVersionRepository.create).toHaveBeenCalled();
  });

  it("marks the prompt/generation failed and rethrows when the provider lacks the capability", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ referenceFrontImageAttachmentId: "att-front", fabricImageAttachmentId: "att-fabric", fabricName: "Cotton" }) as never
    );
    vi.mocked(ReplicateDesignDnaAnalysisRepository.findByProjectId).mockResolvedValue({
      id: "analysis-1",
      status: "APPROVED",
      observations: [{ featureKey: "silhouette", approvedObservation: "A-line", isLocked: true }],
    } as never);
    vi.mocked(ReplicateDesignCompatibilityRepository.findByProjectId).mockResolvedValue({ id: "check-1", overallRating: "COMPATIBLE" } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/jpeg" }, buffer: Buffer.from("x") } as never);
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const provider = { name: "no-capability-provider" };
      return params.call(provider);
    }) as never);

    await expect(generateReplicatedDesign(actor, "proj-1", { imageCount: 1 })).rejects.toThrow();
    expect(ReplicateDesignGenerationRepository.markFailed).toHaveBeenCalled();
    expect(ReplicateDesignPromptRepository.markFailed).toHaveBeenCalled();
  });
});

describe("decideReplicateImage", () => {
  it("rejects an image that doesn't belong to this company", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      project: { companyId: "other-co" },
    } as never);

    await expect(decideReplicateImage(actor, "img-1", { decision: "REJECT" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires explicit confirmation to SELECT", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);

    await expect(decideReplicateImage(actor, "img-1", { decision: "SELECT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts a confirmed SELECT", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(ReplicateDesignImageRepository.update).mockResolvedValue({ id: "img-1", decision: "SELECTED" } as never);

    const updated = await decideReplicateImage(actor, "img-1", { decision: "SELECT", confirmed: true });

    expect(updated).toMatchObject({ decision: "SELECTED" });
    expect(ReplicateDesignImageRepository.update).toHaveBeenCalledWith("img-1", { decision: "SELECTED" });
  });

  it("rejects with no confirmation required", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(ReplicateDesignImageRepository.update).mockResolvedValue({ id: "img-1", decision: "REJECTED" } as never);

    const updated = await decideReplicateImage(actor, "img-1", { decision: "REJECT" });

    expect(updated).toMatchObject({ decision: "REJECTED" });
  });
});

function projectWithCurrentImage(overrides: Record<string, unknown> = {}) {
  return {
    ...baseProject(),
    fabricImageAttachmentId: "att-fabric",
    currentVersion: { id: "version-1", currentImageId: "img-current", designSnapshotJson: {}, currentImage: { id: "img-current", imageAttachmentId: "att-current" } },
    ...overrides,
  };
}

describe("generateReplicateEditPreview", () => {
  it("rejects when the project doesn't exist", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(null);

    await expect(
      generateReplicateEditPreview(actor, "proj-x", { mode: "QUICK", featureLabel: "Collar", newValue: "Mandarin", imageCount: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when no design has been generated yet", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue({ ...baseProject(), currentVersion: null } as never);

    await expect(
      generateReplicateEditPreview(actor, "proj-1", { mode: "QUICK", featureLabel: "Collar", newValue: "Mandarin", imageCount: 1 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when an edit is already in progress", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(projectWithCurrentImage() as never);
    vi.mocked(ReplicateDesignPromptRepository.findActiveSince).mockResolvedValue({ id: "prompt-active" } as never);

    await expect(
      generateReplicateEditPreview(actor, "proj-1", { mode: "QUICK", featureLabel: "Collar", newValue: "Mandarin", imageCount: 1 })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("calls the provider's applyFabric with the current image and the project's own material reference", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(projectWithCurrentImage() as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(runWithFailover).mockImplementation((async (params: { capability: string; call: (p: unknown) => unknown }) => {
      expect(params.capability).toBe("MULTI_FABRIC");
      const provider = { name: "test-provider", applyFabric: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("img"), mimeType: "image/png" }] }) };
      const result = await params.call(provider);
      return { ...(result as object), providerName: "test-provider", model: "test-model" };
    }) as never);
    vi.mocked(ReplicateDesignImageRepository.findByGenerationId).mockResolvedValue([{ id: "preview-1" }] as never);

    const result = await generateReplicateEditPreview(actor, "proj-1", {
      mode: "QUICK",
      featureLabel: "Collar",
      currentValue: "Round Neck",
      newValue: "Mandarin Collar",
      imageCount: 2,
    });

    expect(result.images).toMatchObject([{ id: "preview-1" }]);
    expect(ReplicateDesignGenerationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentImageId: "img-current", editedFeature: "Collar" })
    );
    expect(ReplicateDesignGenerationRepository.markSuccess).toHaveBeenCalled();
    // The generate step's own currentVersionId is never touched by a preview.
    expect(ReplicateDesignProjectRepository.update).not.toHaveBeenCalledWith("proj-1", expect.objectContaining({ currentVersionId: expect.anything() }));
  });
});

describe("applyReplicateEditVariation", () => {
  it("rejects without explicit confirmation", async () => {
    await expect(applyReplicateEditVariation(actor, "img-1", { confirmed: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a previewed image that doesn't belong to this company", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-other" },
    } as never);

    await expect(applyReplicateEditVariation(actor, "img-1", { confirmed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an already-decided preview", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "REJECTED",
      project: { companyId: "co-1" },
    } as never);

    await expect(applyReplicateEditVariation(actor, "img-1", { confirmed: true })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a preview that's no longer based on the current design", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      projectId: "proj-1",
      generationId: "gen-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(projectWithCurrentImage() as never);
    vi.mocked(ReplicateDesignGenerationRepository.findByIdWithPrompt).mockResolvedValue({
      id: "gen-1",
      parentImageId: "img-stale",
      prompt: { id: "prompt-1", specJson: { edit: { mode: "QUICK", featureLabel: "Collar", newValue: "Mandarin" } } },
    } as never);

    await expect(applyReplicateEditVariation(actor, "img-1", { confirmed: true })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("applies the preview, rejects PENDING siblings, and bumps a new AI_MODIFIED version carrying the originating prompt", async () => {
    vi.mocked(ReplicateDesignImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      projectId: "proj-1",
      generationId: "gen-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(projectWithCurrentImage() as never);
    vi.mocked(ReplicateDesignGenerationRepository.findByIdWithPrompt).mockResolvedValue({
      id: "gen-1",
      promptId: "prompt-1",
      parentImageId: "img-current",
      editedFeature: "Collar",
      prompt: { id: "prompt-1", specJson: { edit: { mode: "QUICK", featureLabel: "Collar", newValue: "Mandarin Collar" } } },
    } as never);
    vi.mocked(ReplicateDesignImageRepository.findByGenerationId).mockResolvedValue([
      { id: "img-1", decision: "PENDING" },
      { id: "img-sibling", decision: "PENDING" },
    ] as never);

    const version = await applyReplicateEditVariation(actor, "img-1", { confirmed: true });

    expect(ReplicateDesignImageRepository.update).toHaveBeenCalledWith("img-sibling", { decision: "REJECTED" });
    expect(ReplicateDesignImageRepository.update).toHaveBeenCalledWith("img-1", { decision: "SELECTED" });
    expect(ReplicateDesignVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ currentImageId: "img-1", approvalStatus: "AI_MODIFIED", aiPromptId: "prompt-1", changeSummary: "Changed Collar: Mandarin Collar" })
    );
    expect(version).toMatchObject({ id: "version-1" });
  });
});

describe("approveReplicateVersion / rejectReplicateVersion", () => {
  it("rejects approving when no design has been generated yet", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue({ ...baseProject(), currentVersion: null } as never);

    await expect(approveReplicateVersion(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("approves the current version, stamping the approving user and timestamp", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(
      projectWithCurrentImage({ currentVersion: { id: "version-1", approvalStatus: "DRAFT" } }) as never
    );
    vi.mocked(ReplicateDesignVersionRepository.updateApprovalStatus).mockResolvedValue({ id: "version-1", approvalStatus: "APPROVED" } as never);

    const version = await approveReplicateVersion(actor, "proj-1");

    expect(ReplicateDesignVersionRepository.updateApprovalStatus).toHaveBeenCalledWith(
      "version-1",
      expect.objectContaining({ approvalStatus: "APPROVED", approvedByUserId: "user-1" })
    );
    expect(version).toMatchObject({ approvalStatus: "APPROVED" });
  });

  it("rejects the current version without touching approvedBy/approvedAt", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(
      projectWithCurrentImage({ currentVersion: { id: "version-1", approvalStatus: "AI_MODIFIED" } }) as never
    );
    vi.mocked(ReplicateDesignVersionRepository.updateApprovalStatus).mockResolvedValue({ id: "version-1", approvalStatus: "REJECTED" } as never);

    await rejectReplicateVersion(actor, "proj-1");

    expect(ReplicateDesignVersionRepository.updateApprovalStatus).toHaveBeenCalledWith(
      "version-1",
      expect.objectContaining({ approvalStatus: "REJECTED", approvedByUserId: null, approvedAt: null })
    );
  });
});

describe("generateReplicateTechPack", () => {
  const fakePart1 = {
    identification: {}, construction: {}, closure: { closureType: "", closureDetails: "" }, seamCallouts: [], visibleColors: [],
    suggestedColorways: [], artworkItems: [], artworkSummary: "", patternPrintType: "", patternPrintNotes: "",
  };
  const fakePart2 = {
    bomItems: [], measurementPoints: [], gradeRulesNotes: "", mainLabelSpec: "", sizeLabelSpec: "", careLabelSpec: "",
    hangtagSpec: "", polybagSpec: "", foldingInstructions: "", cartonPackingSpec: "", barcodePlacement: "",
  };
  const fakePagePrompts = { pagePrompts: ["p1", "p2", "p3", "p4"], designerNotes: "", suggestedAdditionalViews: "" };

  it("rejects when no design has been generated yet", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue({ ...baseProject(), currentVersion: null } as never);

    await expect(generateReplicateTechPack(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when a tech pack is already being generated", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(projectWithCurrentImage() as never);
    vi.mocked(ReplicateDesignTechPackRepository.findLatestByProjectId).mockResolvedValue({
      id: "techpack-active",
      status: "IN_PROGRESS",
      createdAt: new Date(),
    } as never);

    await expect(generateReplicateTechPack(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("runs the full 3-call pipeline plus one page image per needsImage page, then marks the tech pack SUCCESS", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(
      projectWithCurrentImage({ dnaAnalysis: { observations: [{ featureKey: "garmentCategory", approvedObservation: "T-Shirt" }] } }) as never
    );
    vi.mocked(ReplicateDesignTechPackRepository.findLatestByProjectId).mockResolvedValue(null);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockResolvedValue({ data: fakePart2, model: "claude-sonnet-5" } as never);
    vi.mocked(generatePagePrompts).mockResolvedValue({ data: fakePagePrompts, model: "claude-sonnet-5" } as never);
    vi.mocked(runWithFailover).mockImplementation((async (params: { capability: string; call: (p: unknown) => unknown }) => {
      expect(params.capability).toBe("TECHNICAL_FLAT");
      const provider = { name: "test-provider", generateTechnicalFlat: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("img"), mimeType: "image/png" }] }) };
      return params.call(provider);
    }) as never);
    vi.mocked(ReplicateDesignTechPackRepository.markSuccess).mockResolvedValue({ id: "techpack-1", status: "SUCCESS" } as never);

    const result = await generateReplicateTechPack(actor, "proj-1");

    expect(generateGarmentAnalysisPart1).toHaveBeenCalledTimes(1);
    expect(generateGarmentAnalysisPart2).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1 }));
    expect(generatePagePrompts).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1, part2: fakePart2 }));
    expect(ReplicateDesignTechPackRepository.markSuccess).toHaveBeenCalledWith(
      "techpack-1",
      expect.objectContaining({ pages: expect.arrayContaining([expect.objectContaining({ pageNumber: 1 })]) })
    );
    expect(result).toMatchObject({ status: "SUCCESS" });
  });

  it("marks the tech pack FAILED and propagates the error when an AI call fails", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findByIdWithDetails).mockResolvedValue(projectWithCurrentImage() as never);
    vi.mocked(ReplicateDesignTechPackRepository.findLatestByProjectId).mockResolvedValue(null);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockRejectedValue(new Error("Anthropic call failed"));

    await expect(generateReplicateTechPack(actor, "proj-1")).rejects.toThrow();

    expect(generateGarmentAnalysisPart2).not.toHaveBeenCalled();
    expect(ReplicateDesignTechPackRepository.markFailed).toHaveBeenCalledWith("techpack-1", expect.stringContaining("Anthropic call failed"));
    expect(ReplicateDesignTechPackRepository.markSuccess).not.toHaveBeenCalled();
  });
});

describe("getLatestReplicateTechPack", () => {
  it("rejects an unowned/nonexistent project", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(null);

    await expect(getLatestReplicateTechPack("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the latest tech pack for an owned project", async () => {
    vi.mocked(ReplicateDesignProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ReplicateDesignTechPackRepository.findLatestByProjectId).mockResolvedValue({ id: "techpack-1", status: "SUCCESS" } as never);

    const techPack = await getLatestReplicateTechPack("co-1", "proj-1");

    expect(techPack).toMatchObject({ id: "techpack-1" });
  });
});

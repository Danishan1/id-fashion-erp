import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentMetadata: vi.fn(),
}));
vi.mock("@/core/ai-designer/fabric-analysis/analyze", () => ({ analyzeFabric: vi.fn() }));
vi.mock("@/core/ai-designer/product-suggestions/generate", () => ({ generateProductSuggestions: vi.fn() }));
vi.mock("@/core/ai-designer/sketch-analysis/analyze", () => ({ analyzeSketch: vi.fn() }));
vi.mock("@/core/ai/provider-manager/AIProviderManager", () => ({ runWithFailover: vi.fn() }));
vi.mock("@/core/documents/company-header", () => ({
  getCompanyHeaderLines: vi.fn().mockResolvedValue({ companyName: "Test Co", companyDetailLines: [] }),
  formatDocDate: vi.fn((d: Date) => new Date(d).toISOString().slice(0, 10)),
}));
vi.mock("@/core/ai-designer/export/tech-pack-pdf", () => ({
  renderTechPackPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  renderTechPackDocumentPdf: vi.fn().mockResolvedValue(Buffer.from("tech-pack-pdf")),
  renderTechPackDocumentPdfV2: vi.fn().mockResolvedValue(Buffer.from("tech-pack-pdf")),
}));
vi.mock("@/core/ai-designer/tech-pack/generate", () => ({
  generateGarmentAnalysisPart1: vi.fn(),
  generateGarmentAnalysisPart2: vi.fn(),
  generateGarmentAnalysisPart3: vi.fn(),
  generateGarmentAnalysisPart4: vi.fn(),
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn() },
}));
vi.mock("./ai-designer.repository", () => ({
  AiDesignerProjectRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  AiDesignerPromptRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markSuccessWithProvider: vi.fn(),
    markFailed: vi.fn(),
    findActiveSince: vi.fn(),
  },
  AiDesignerGenerationRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findByIdWithPrompt: vi.fn(),
  },
  AiDesignerImageRepository: {
    createMany: vi.fn(),
    findByGenerationId: vi.fn(),
    findByProjectId: vi.fn(),
    findById: vi.fn(),
    findWithProjectOwner: vi.fn(),
    update: vi.fn(),
  },
  AiDesignerVersionRepository: {
    create: vi.fn(),
    findByProjectId: vi.fn(),
    count: vi.fn(),
    updateApprovalStatus: vi.fn(),
  },
  AiDesignerTechPackRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findLatestByProjectId: vi.fn(),
    findByIdScoped: vi.fn(),
    update: vi.fn(),
    createRevision: vi.fn(),
  },
  AiDesignerSketchAnalysisRepository: {
    findByProjectId: vi.fn(),
    upsertWithObservations: vi.fn(),
    markStale: vi.fn(),
    update: vi.fn(),
    approveAllObservations: vi.fn(),
  },
  AiDesignerSketchObservationRepository: {
    findByAnalysisId: vi.fn(),
    findWithAnalysisOwner: vi.fn(),
    update: vi.fn(),
  },
  AiDesignerSketchAnalysisRunRepository: {
    create: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
    findActiveSince: vi.fn(),
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { uploadAttachment, getAttachmentForDownload, deleteAttachment } = await import("@/core/attachments/AttachmentService");
const { runWithFailover } = await import("@/core/ai/provider-manager/AIProviderManager");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateGarmentAnalysisPart1, generateGarmentAnalysisPart2, generateGarmentAnalysisPart3, generateGarmentAnalysisPart4 } = await import(
  "@/core/ai-designer/tech-pack/generate"
);
const { ProductRepository } = await import("@/modules/products/product.repository");
const { analyzeSketch } = await import("@/core/ai-designer/sketch-analysis/analyze");
const { generateProductSuggestions } = await import("@/core/ai-designer/product-suggestions/generate");
const {
  AiDesignerProjectRepository,
  AiDesignerPromptRepository,
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerVersionRepository,
  AiDesignerTechPackRepository,
  AiDesignerSketchAnalysisRepository,
  AiDesignerSketchObservationRepository,
  AiDesignerSketchAnalysisRunRepository,
} = await import("./ai-designer.repository");
const {
  createProject,
  selectExistingFabric,
  uploadFabricImage,
  uploadSketchImage,
  deleteSketchImage,
  runSketchAnalysis,
  getSketchAnalysis,
  updateSketchObservation,
  resetSketchObservationToAi,
  setSketchObservationLock,
  approveSketchAnalysis,
  detectDesignOverrides,
  runProductSuggestions,
  getProductSuggestions,
  applyProductSuggestionAndGenerate,
  generateDesign,
  generateEditPreview,
  applyEditVariation,
  approveCurrentVersion,
  rejectCurrentVersion,
  applySecondFabric,
  uploadEmbellishmentMotif,
  deleteEmbellishmentMotif,
  applyEmbellishments,
  generateTechPack,
  exportTechPackPdf,
  updateTechPackField,
  approveTechPack,
  revertTechPackToOriginal,
  decideImage,
  listImages,
  exportProject,
  updateBrandName,
  uploadBrandLogo,
  deleteBrandLogo,
  updateLogoPosition,
  applyBranding,
  getBrandDefaults,
} = await import("./ai-designer.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    companyId: "co-1",
    projectNumber: "AID-2026-00001",
    projectName: "Test Project",
    status: "DRAFT",
    creationMode: "STANDARD" as "STANDARD" | "SKETCH",
    currentStep: "FABRIC_SELECTION",
    completedSteps: [] as string[],
    sketchImageAttachmentId: null,
    fabricSource: null,
    fabricProductId: null,
    fabricImageAttachmentId: null,
    fabricName: null,
    fabricCode: null,
    fabricComposition: null,
    fabricGsm: null,
    fabricWidth: null,
    fabricColor: null,
    targetCustomer: null,
    ageGroup: null,
    productCategory: null,
    designSelectionsJson: null,
    modelGender: null,
    modelBodyType: null,
    modelPose: null,
    environmentKey: null,
    environmentLabel: null,
    isCustomEnvironment: false,
    currentVersionId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: { id: "user-1", fullName: "Test Designer" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("AID-2026-00001");
  vi.mocked(AiDesignerProjectRepository.create).mockReset();
  vi.mocked(AiDesignerProjectRepository.update)
    .mockReset()
    .mockImplementation(((_id: string, data: Record<string, unknown>) => Promise.resolve({ ...data })) as never);
  vi.mocked(AiDesignerProjectRepository.findAnyById).mockReset();
  vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockReset();
  vi.mocked(ProductRepository.findMaterialById).mockReset();
  vi.mocked(AiDesignerPromptRepository.create).mockReset().mockResolvedValue({ id: "prompt-1" } as never);
  vi.mocked(AiDesignerPromptRepository.markSuccess).mockReset();
  vi.mocked(AiDesignerPromptRepository.markSuccessWithProvider).mockReset();
  vi.mocked(AiDesignerPromptRepository.markFailed).mockReset();
  vi.mocked(AiDesignerPromptRepository.findActiveSince).mockReset().mockResolvedValue(null);
  vi.mocked(AiDesignerGenerationRepository.create).mockReset().mockResolvedValue({ id: "gen-1" } as never);
  vi.mocked(AiDesignerGenerationRepository.markSuccess).mockReset();
  vi.mocked(AiDesignerGenerationRepository.markFailed).mockReset();
  vi.mocked(AiDesignerGenerationRepository.findByIdWithPrompt).mockReset();
  vi.mocked(AiDesignerImageRepository.createMany).mockReset();
  vi.mocked(AiDesignerImageRepository.findByGenerationId).mockReset();
  vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockReset();
  vi.mocked(AiDesignerImageRepository.update).mockReset();
  vi.mocked(AiDesignerVersionRepository.create).mockReset().mockResolvedValue({ id: "version-1", versionNumber: 1 } as never);
  vi.mocked(AiDesignerVersionRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(AiDesignerVersionRepository.updateApprovalStatus).mockReset();
  vi.mocked(uploadAttachment).mockReset().mockResolvedValue({ id: "attachment-1" } as never);
  vi.mocked(getAttachmentForDownload).mockReset();
  vi.mocked(deleteAttachment).mockReset();
  vi.mocked(runWithFailover).mockReset();
  vi.mocked(AiDesignerTechPackRepository.create).mockReset().mockResolvedValue({ id: "techpack-1" } as never);
  vi.mocked(AiDesignerTechPackRepository.markSuccess).mockReset();
  vi.mocked(AiDesignerTechPackRepository.markFailed).mockReset();
  vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockReset();
  vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockReset();
  vi.mocked(AiDesignerTechPackRepository.update).mockReset();
  vi.mocked(AiDesignerTechPackRepository.createRevision).mockReset();
  vi.mocked(generateGarmentAnalysisPart1).mockReset();
  vi.mocked(generateGarmentAnalysisPart2).mockReset();
  vi.mocked(generateGarmentAnalysisPart3).mockReset();
  vi.mocked(generateGarmentAnalysisPart4).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(analyzeSketch).mockReset();
  vi.mocked(generateProductSuggestions).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRepository.findByProjectId).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRepository.upsertWithObservations).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRepository.markStale).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRepository.update).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRepository.approveAllObservations).mockReset();
  vi.mocked(AiDesignerSketchObservationRepository.findByAnalysisId).mockReset();
  vi.mocked(AiDesignerSketchObservationRepository.findWithAnalysisOwner).mockReset();
  vi.mocked(AiDesignerSketchObservationRepository.update).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRunRepository.create).mockReset().mockResolvedValue({ id: "sketch-run-1" } as never);
  vi.mocked(AiDesignerSketchAnalysisRunRepository.markSuccess).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRunRepository.markFailed).mockReset();
  vi.mocked(AiDesignerSketchAnalysisRunRepository.findActiveSince).mockReset().mockResolvedValue(null);
});

describe("createProject", () => {
  it("creates a DRAFT project with a real document number", async () => {
    vi.mocked(AiDesignerProjectRepository.create).mockResolvedValue(baseProject({ id: "proj-1" }) as never);

    const project = await createProject(actor, { projectName: "Summer Line", creationMode: "STANDARD" });

    expect(project.id).toBe("proj-1");
    expect(AiDesignerProjectRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "Summer Line", status: "DRAFT", currentStep: "FABRIC_SELECTION", creationMode: "STANDARD" })
    );
  });
});

describe("selectExistingFabric", () => {
  it("auto-fills only Name/Code/Supplier from the real Fabric Master, leaving GSM/Composition/Width/Color blank", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "mat-1",
      styleName: "Cotton Fabric",
      styleCode: "MAT-00001",
      defaultSupplierId: "sup-1",
    } as never);

    await selectExistingFabric(actor, "proj-1", { fabricProductId: "mat-1" });

    const [, data] = vi.mocked(AiDesignerProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({
      fabricSource: "EXISTING",
      fabricProductId: "mat-1",
      fabricName: "Cotton Fabric",
      fabricCode: "MAT-00001",
      fabricSupplierId: "sup-1",
    });
    expect(data).not.toHaveProperty("fabricGsm");
    expect(data).not.toHaveProperty("fabricComposition");
    expect(data).not.toHaveProperty("fabricWidth");
    expect(data).not.toHaveProperty("fabricColor");
  });

  it("rejects a fabric id that isn't a real raw material in this company", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);

    await expect(selectExistingFabric(actor, "proj-1", { fabricProductId: "mat-x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // The real Fabric Master (Product) carries no photo of its own — an
  // already-uploaded fabric reference image must never be wiped out just
  // because the user also picked a Fabric Master row for its Name/Code/
  // Supplier metadata. This is the actual fix for the reported bug: metadata
  // and the real image are now independent, and both must be able to coexist.
  it("does NOT clear an already-uploaded fabric reference image when metadata is picked afterward", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ fabricImageAttachmentId: "att-real-photo" }) as never
    );
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "mat-1",
      styleName: "Cotton Fabric",
      styleCode: "MAT-00001",
      defaultSupplierId: "sup-1",
    } as never);

    await selectExistingFabric(actor, "proj-1", { fabricProductId: "mat-1" });

    const [, data] = vi.mocked(AiDesignerProjectRepository.update).mock.calls[0];
    expect(data).not.toHaveProperty("fabricImageAttachmentId");
  });
});

describe("uploadFabricImage", () => {
  it("retrieves and stores the real fabric image as an attachment, and does NOT clear already-selected fabric metadata", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ fabricSource: "EXISTING", fabricProductId: "mat-1", fabricName: "Cotton Fabric" }) as never
    );
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-real-photo" } as never);

    const result = await uploadFabricImage(actor, "proj-1", {
      buffer: Buffer.from("real-fabric-photo-bytes"),
      fileName: "fabric.jpg",
      mimeType: "image/jpeg",
    });

    expect(result.attachment.id).toBe("att-real-photo");
    const [, data] = vi.mocked(AiDesignerProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({ fabricImageAttachmentId: "att-real-photo" });
    expect(data).not.toHaveProperty("fabricProductId");
    expect(data).not.toHaveProperty("fabricSupplierId");
  });

  it("rejects a file that isn't a real image type", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);

    await expect(
      uploadFabricImage(actor, "proj-1", { buffer: Buffer.from("not-an-image"), fileName: "fabric.pdf", mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
});

const FABRIC_IMAGE_BYTES = Buffer.from("REAL-FABRIC-PHOTO-BYTES-NOT-A-DESCRIPTION");

function readyProjectWithFabricImage(overrides: Record<string, unknown> = {}) {
  return baseProject({
    fabricImageAttachmentId: "att-fabric-photo",
    targetCustomer: "WOMEN",
    ageGroup: "18-25",
    productCategory: "Dress",
    modelGender: "Female",
    modelBodyType: "Regular",
    modelPose: "Front",
    environmentLabel: "Studio White",
    ...overrides,
  });
}

describe("generateDesign — the wizard-step gate", () => {
  it("blocks generation until fabric-image/customer/age/category/model/environment are all set", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ fabricName: "Cotton" }) as never);

    await expect(generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerPromptRepository.create).not.toHaveBeenCalled();
  });

  // Acceptance criterion: fabric metadata (name/composition/GSM/color) alone
  // is NOT sufficient — a project with every text field filled but no real
  // fabric photo must still be blocked, since generation without the photo
  // cannot preserve the actual fabric.
  it("blocks generation when fabric TEXT metadata is fully filled but no real fabric reference image was ever uploaded", async () => {
    const textOnlyProject = baseProject({
      fabricName: "Blue Floral",
      fabricComposition: "100% Cotton",
      fabricGsm: "180",
      fabricColor: "Blue",
      fabricImageAttachmentId: null,
      targetCustomer: "WOMEN",
      ageGroup: "18-25",
      productCategory: "Dress",
      modelGender: "Female",
      modelBodyType: "Regular",
      modelPose: "Front",
      environmentLabel: "Studio White",
    });
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(textOnlyProject as never);

    await expect(generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerPromptRepository.create).not.toHaveBeenCalled();
    expect(getAttachmentForDownload).not.toHaveBeenCalled();
  });

  it("proceeds once every gated field including a real fabric image is filled, sending the ACTUAL fabric image bytes to the provider and creating version 1", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readyProjectWithFabricImage() as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: FABRIC_IMAGE_BYTES,
    } as never);
    const generateFromFabricReference = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("generated-design"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    const generate = vi.fn();
    // Mocks runWithFailover's own real contract: it resolves the real
    // provider itself and hands it to the caller's `call` callback — this
    // test exercises that exact callback (ai-designer.service.ts's own
    // logic), not AIProviderManager's internal candidate-selection/failover
    // logic, which has its own dedicated test file.
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generate, generateFromFabricReference } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }] as never);

    const result = await generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" });

    // The real fabric photo is fetched by the exact attachment the project
    // points at, and its actual bytes/mimeType are what reaches the
    // provider — not a text description of it.
    expect(getAttachmentForDownload).toHaveBeenCalledWith("co-1", "att-fabric-photo");
    expect(runWithFailover).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "FABRIC_REFERENCE", aiDesignerProjectId: "proj-1", inputImagePresent: true })
    );
    expect(generateFromFabricReference).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        fabricImage: { buffer: FABRIC_IMAGE_BYTES, mimeType: "image/jpeg" },
      })
    );
    // The provider's own plain text-to-image `generate` must never be used
    // for this flow — that is exactly the bug being fixed.
    expect(generate).not.toHaveBeenCalled();

    expect(result.images).toEqual([{ id: "img-1" }]);
    expect(AiDesignerVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ versionNumber: 1, currentImageId: "img-1", changeSummary: "Initial design generated." })
    );
    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", expect.objectContaining({ currentVersionId: "version-1" }));
    // The prompt row is corrected to whichever provider actually served the
    // request (openai here) rather than staying on its creation-time
    // placeholder — real under automatic failover, where that can differ
    // from whatever was originally expected.
    expect(AiDesignerPromptRepository.markSuccessWithProvider).toHaveBeenCalledWith("prompt-1", "openai", "gpt-image-1");
  });

  it("throws a clean, honest error when the configured provider has no image-reference generation capability (e.g. a pure text-to-image provider) — never silently falls back to text-only", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readyProjectWithFabricImage() as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/jpeg" },
      buffer: FABRIC_IMAGE_BYTES,
    } as never);
    // Mirrors the real cloudflare provider: only `generate` exists, no
    // image-input capability of any kind. Mirrors AIProviderManager's own
    // real behavior — the call callback's own UNSUPPORTED_OPERATION throw
    // is caught and re-wrapped as a clean BusinessRuleError, never left to
    // silently fall through to a text-only call.
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      try {
        await params.call({ name: "cloudflare", model: "flux-1-schnell", generate: vi.fn() } as never);
        throw new Error("test setup error: the call callback should have thrown UNSUPPORTED_OPERATION");
      } catch (err) {
        throw new BusinessRuleError("AI_SERVICE_ERROR", err instanceof Error ? err.message : "failed");
      }
    });

    await expect(generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" })).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
      message: expect.stringContaining("does not support generating a design from a fabric reference image"),
    });
    expect(AiDesignerImageRepository.createMany).not.toHaveBeenCalled();
  });

  it("blocks a second generation call while one is already in progress", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readyProjectWithFabricImage() as never);
    vi.mocked(AiDesignerPromptRepository.findActiveSince).mockResolvedValue({ id: "prompt-active" } as never);

    await expect(generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("generateEditPreview — Edit Design workspace, step 1", () => {
  it("requires a design to already exist before editing", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: null }) as never
    );

    await expect(
      generateEditPreview(actor, "proj-1", { mode: "QUICK", featureLabel: "Collar", currentValue: "Round Neck", newValue: "Mandarin Collar", imageCount: 1, viewAngle: "FRONT" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // The real-world path: fabricImageAttachmentId is ALWAYS set by the time any
  // edit can happen (assertReadyToGenerate requires it before Generate Design
  // itself can even run). Re-supplying that real original fabric photo as a
  // second reference image on every edit (via applyFabric) is the actual fix
  // for a confirmed-live bug: chaining edits from image-to-image alone let the
  // fabric print visibly drift from the original over successive edits, since
  // "preserve fabric" text has no real image to check against.
  it("generates preview images WITHOUT bumping the version, re-supplying the real original fabric photo as a second reference image via applyFabric", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        fabricName: "Cotton",
        fabricImageAttachmentId: "att-fabric-original",
        currentVersion: { id: "version-1", currentImageId: "img-parent", currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockImplementation(
      async (_companyId: string, attachmentId: string) =>
        ({ attachment: { mimeType: "image/png" }, buffer: Buffer.from(attachmentId) }) as never
    );
    const applyFabric = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("edited"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generate: vi.fn(), applyFabric } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-preview-1" }] as never);

    const result = await generateEditPreview(actor, "proj-1", {
      mode: "QUICK",
      featureLabel: "Collar",
      currentValue: "Round Neck",
      newValue: "Mandarin Collar",
      imageCount: 1,
      viewAngle: "FRONT",
    });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "MULTI_FABRIC" }));
    expect(applyFabric).toHaveBeenCalledWith(
      expect.objectContaining({
        baseImage: { buffer: Buffer.from("att-parent"), mimeType: "image/png" },
        swatchImage: { buffer: Buffer.from("att-fabric-original"), mimeType: "image/png" },
      })
    );
    expect(AiDesignerGenerationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentImageId: "img-parent", editedFeature: "Collar", requestedImageCount: 1 })
    );
    expect(result.images).toEqual([{ id: "img-preview-1" }]);
    // The whole point of a "preview" — nothing about the current design changes yet.
    expect(AiDesignerVersionRepository.create).not.toHaveBeenCalled();
    expect(AiDesignerProjectRepository.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ currentVersionId: expect.anything() }));
  });

  // Defensive fallback only — not a realistic case (assertReadyToGenerate
  // guarantees a real fabric photo exists before any design/edit can exist at
  // all) but proven here so a project somehow missing it still degrades to a
  // working single-image edit rather than crashing.
  it("falls back to a plain single-image edit when no fabric reference photo exists on the project", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        fabricImageAttachmentId: null,
        currentVersion: { id: "version-1", currentImageId: "img-parent", currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from("parent"),
    } as never);
    const generateVariation = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("edited"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generate: vi.fn(), generateVariation } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-preview-1" }] as never);

    await generateEditPreview(actor, "proj-1", {
      mode: "QUICK",
      featureLabel: "Collar",
      currentValue: "Round Neck",
      newValue: "Mandarin Collar",
      imageCount: 1,
      viewAngle: "FRONT",
    });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "IMAGE_EDIT" }));
    expect(generateVariation).toHaveBeenCalled();
  });

  it("blocks editing while an edit is already in progress", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { id: "version-1", currentImageId: "img-parent", currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } } }) as never
    );
    vi.mocked(AiDesignerPromptRepository.findActiveSince).mockResolvedValue({ id: "prompt-active" } as never);

    await expect(
      generateEditPreview(actor, "proj-1", { mode: "QUICK", featureLabel: "Collar", currentValue: "Round Neck", newValue: "Mandarin Collar", imageCount: 1, viewAngle: "FRONT" })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("applyEditVariation — Edit Design workspace, step 2", () => {
  const pendingImage = { id: "img-preview-1", projectId: "proj-1", generationId: "gen-1", decision: "PENDING", project: { companyId: "co-1" } };
  const currentProject = baseProject({
    currentVersion: {
      id: "version-1",
      currentImageId: "img-parent",
      designSnapshotJson: { fabric: {} },
      approvalStatus: "DRAFT",
      currentImage: { id: "img-parent", imageAttachmentId: "att-parent" },
    },
  });
  const matchingGeneration = {
    id: "gen-1",
    parentImageId: "img-parent",
    promptId: "prompt-1",
    editedFeature: "Collar",
    prompt: { specJson: { edit: { mode: "QUICK", featureLabel: "Collar", newValue: "Mandarin Collar" } } },
  };

  it("requires explicit confirmation", async () => {
    await expect(applyEditVariation(actor, "img-preview-1", { confirmed: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerImageRepository.findWithProjectOwner).not.toHaveBeenCalled();
  });

  it("404s for an image from another company", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({ ...pendingImage, project: { companyId: "co-OTHER" } } as never);

    await expect(applyEditVariation(actor, "img-preview-1", { confirmed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to re-apply an image that's already been decided", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({ ...pendingImage, decision: "SELECTED" } as never);

    await expect(applyEditVariation(actor, "img-preview-1", { confirmed: true })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("refuses to apply a stale preview whose parent image no longer matches the current design", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue(pendingImage as never);
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(currentProject as never);
    vi.mocked(AiDesignerGenerationRepository.findByIdWithPrompt).mockResolvedValue({ ...matchingGeneration, parentImageId: "img-SOME-OTHER" } as never);

    await expect(applyEditVariation(actor, "img-preview-1", { confirmed: true })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiDesignerVersionRepository.create).not.toHaveBeenCalled();
  });

  it("selects the image, rejects its siblings, and bumps a new AI_MODIFIED version carrying the AI prompt", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue(pendingImage as never);
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(currentProject as never);
    vi.mocked(AiDesignerGenerationRepository.findByIdWithPrompt).mockResolvedValue(matchingGeneration as never);
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([
      { id: "img-preview-1", decision: "PENDING" },
      { id: "img-preview-2", decision: "PENDING" },
    ] as never);
    vi.mocked(AiDesignerVersionRepository.count).mockResolvedValue(1);
    vi.mocked(AiDesignerVersionRepository.create).mockResolvedValue({ id: "version-2", versionNumber: 2 } as never);

    const version = await applyEditVariation(actor, "img-preview-1", { confirmed: true });

    expect(AiDesignerImageRepository.update).toHaveBeenCalledWith("img-preview-1", { decision: "SELECTED" });
    expect(AiDesignerImageRepository.update).toHaveBeenCalledWith("img-preview-2", { decision: "REJECTED" });
    expect(AiDesignerVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        versionNumber: 2,
        currentImageId: "img-preview-1",
        approvalStatus: "AI_MODIFIED",
        aiPromptId: "prompt-1",
      })
    );
    expect(version.versionNumber).toBe(2);
  });

  it("persists Technical Edit Mode's structured fields onto the new version", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue(pendingImage as never);
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(currentProject as never);
    vi.mocked(AiDesignerGenerationRepository.findByIdWithPrompt).mockResolvedValue({
      ...matchingGeneration,
      prompt: { specJson: { edit: { mode: "TECHNICAL", featureLabel: "Collar", technicalFields: { "Collar Type": "Mandarin", "Finished Height": "3.5 cm" } } } },
    } as never);
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-preview-1", decision: "PENDING" }] as never);
    vi.mocked(AiDesignerVersionRepository.count).mockResolvedValue(1);
    vi.mocked(AiDesignerVersionRepository.create).mockResolvedValue({ id: "version-2", versionNumber: 2 } as never);

    await applyEditVariation(actor, "img-preview-1", { confirmed: true });

    expect(AiDesignerVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ technicalChangesJson: { "Collar Type": "Mandarin", "Finished Height": "3.5 cm" } })
    );
  });
});

describe("approveCurrentVersion / rejectCurrentVersion", () => {
  it("requires a current version to exist before approving", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject({ currentVersion: null }) as never);

    await expect(approveCurrentVersion(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("approves the current version, recording who and when", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { id: "version-1", approvalStatus: "AI_MODIFIED" } }) as never
    );
    vi.mocked(AiDesignerVersionRepository.updateApprovalStatus).mockResolvedValue({ id: "version-1", approvalStatus: "APPROVED" } as never);

    await approveCurrentVersion(actor, "proj-1");

    expect(AiDesignerVersionRepository.updateApprovalStatus).toHaveBeenCalledWith(
      "version-1",
      expect.objectContaining({ approvalStatus: "APPROVED", approvedByUserId: "user-1" })
    );
  });

  it("rejects the current version", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { id: "version-1", approvalStatus: "AI_MODIFIED" } }) as never
    );
    vi.mocked(AiDesignerVersionRepository.updateApprovalStatus).mockResolvedValue({ id: "version-1", approvalStatus: "REJECTED" } as never);

    await rejectCurrentVersion(actor, "proj-1");

    expect(AiDesignerVersionRepository.updateApprovalStatus).toHaveBeenCalledWith("version-1", expect.objectContaining({ approvalStatus: "REJECTED" }));
  });
});

describe("decideImage — Select / Reject", () => {
  it("selects an image only when explicitly confirmed", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(AiDesignerImageRepository.update).mockResolvedValue({ id: "img-1", decision: "SELECTED" } as never);

    await expect(decideImage(actor, "img-1", { decision: "SELECT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerImageRepository.update).not.toHaveBeenCalled();

    const result = await decideImage(actor, "img-1", { decision: "SELECT", confirmed: true });
    expect(result.decision).toBe("SELECTED");
    expect(AiDesignerImageRepository.update).toHaveBeenCalledWith("img-1", { decision: "SELECTED" });
  });

  it("rejects an image with a single click, no confirmation required", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-1" },
    } as never);
    vi.mocked(AiDesignerImageRepository.update).mockResolvedValue({ id: "img-1", decision: "REJECTED" } as never);

    const result = await decideImage(actor, "img-1", { decision: "REJECT" });
    expect(result.decision).toBe("REJECTED");
  });

  it("refuses to decide an image belonging to another company", async () => {
    vi.mocked(AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { companyId: "co-OTHER" },
    } as never);

    await expect(decideImage(actor, "img-1", { decision: "REJECT" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// Backs the Step 9 gallery so Select/Reject decisions survive a page reload
// instead of only ever showing the most recent in-session generate/edit call
// (a real bug found during live browser testing, fixed by adding this real
// listImages()/GET .../images endpoint backed by the repository's own
// already-existing findByProjectId).
describe("listImages — gallery persistence after reload", () => {
  it("returns every generated image for the project, across every generation", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerImageRepository.findByProjectId).mockResolvedValue([
      { id: "img-1", decision: "SELECTED" },
      { id: "img-2", decision: "REJECTED" },
    ] as never);

    const images = await listImages("co-1", "proj-1");

    expect(images).toHaveLength(2);
    expect(AiDesignerImageRepository.findByProjectId).toHaveBeenCalledWith("proj-1");
  });

  it("404s for a project that doesn't belong to this company", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(null);

    await expect(listImages("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("exportProject", () => {
  it("requires a generated design before exporting", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject({ currentVersion: null }) as never);

    await expect(exportProject(actor, "proj-1", "png")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // A real, minimal 1x1 PNG — exportProject now genuinely converts via
  // `sharp` rather than relabeling the file extension over whatever bytes the
  // provider actually returned (a real bug found live: the configured
  // provider can return JPEG bytes regardless of which format the user
  // requested — a ".png" download must contain real PNG bytes, not JPEG ones
  // wearing a ".png" name).
  const REAL_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("converts to a real PNG for the png format", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from(REAL_PNG_BASE64, "base64"),
    } as never);

    const result = await exportProject(actor, "proj-1", "png");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(result.fileName).toBe("AID-2026-00001.png");
  });

  it("converts to a real JPEG for the jpg format, even when the source bytes are PNG", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from(REAL_PNG_BASE64, "base64"),
    } as never);

    const result = await exportProject(actor, "proj-1", "jpg");

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(result.fileName).toBe("AID-2026-00001.jpg");
  });

  it("renders a PDF tech pack for the pdf format", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from("raw-image"),
    } as never);

    const result = await exportProject(actor, "proj-1", "pdf");

    expect(result.mimeType).toBe("application/pdf");
    expect(result.buffer.toString()).toBe("pdf");
  });
});

describe("applySecondFabric", () => {
  it("requires a design to already exist", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: null }) as never
    );

    await expect(applySecondFabric(actor, "proj-1", { applyAreas: ["YOKE"] })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("requires a second fabric image to already be uploaded", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        secondFabricImageAttachmentId: null,
      }) as never
    );

    await expect(applySecondFabric(actor, "proj-1", { applyAreas: ["YOKE"] })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("applies the second fabric via provider.applyFabric and bumps a new version", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        secondFabricImageAttachmentId: "att-second-fabric",
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockImplementation(async (_companyId: string, id: string) => ({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from(id),
    }) as never);
    const applyFabric = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("composed"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generate: vi.fn(), applyFabric } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-composed" }] as never);
    vi.mocked(AiDesignerVersionRepository.count).mockResolvedValue(1);
    vi.mocked(AiDesignerVersionRepository.create).mockResolvedValue({ id: "version-2", versionNumber: 2 } as never);

    const result = await applySecondFabric(actor, "proj-1", { applyAreas: ["YOKE", "SLEEVES"] });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "MULTI_FABRIC" }));
    expect(applyFabric).toHaveBeenCalledWith(
      expect.objectContaining({
        baseImage: { buffer: Buffer.from("att-parent"), mimeType: "image/png" },
        swatchImage: { buffer: Buffer.from("att-second-fabric"), mimeType: "image/png" },
      })
    );
    expect(AiDesignerGenerationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentImageId: "img-parent", editedFeature: "Second Fabric Application: YOKE, SLEEVES" })
    );
    expect(result.version.versionNumber).toBe(2);
  });

  it("throws a clean error when the configured provider has no applyFabric capability", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        secondFabricImageAttachmentId: "att-second-fabric",
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      // No applyFabric on this provider — the call itself should throw before runWithFailover ever resolves.
      await params.call({ name: "cloudflare", model: "flux-1-schnell", generate: vi.fn() } as never);
      throw new Error("unreachable");
    });

    await expect(applySecondFabric(actor, "proj-1", { applyAreas: ["YOKE"] })).rejects.toThrow(
      /does not support applying a second fabric/
    );
  });
});

describe("uploadEmbellishmentMotif / deleteEmbellishmentMotif", () => {
  it("stores the uploaded motif image as an attachment", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-motif" } as never);

    const result = await uploadEmbellishmentMotif(actor, "proj-1", {
      buffer: Buffer.from("motif-bytes"),
      fileName: "motif.jpg",
      mimeType: "image/jpeg",
    });

    expect(result.attachment.id).toBe("att-motif");
    const [, data] = vi.mocked(AiDesignerProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({ embellishmentMotifAttachmentId: "att-motif" });
  });

  it("rejects a file that isn't a real image type", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);

    await expect(
      uploadEmbellishmentMotif(actor, "proj-1", { buffer: Buffer.from("not-an-image"), fileName: "motif.pdf", mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("requires an existing motif image before deleting", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ embellishmentMotifAttachmentId: null }) as never
    );

    await expect(deleteEmbellishmentMotif(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deleteAttachment).not.toHaveBeenCalled();
  });

  it("deletes the attachment and clears the pointer", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ embellishmentMotifAttachmentId: "att-motif" }) as never
    );

    await deleteEmbellishmentMotif(actor, "proj-1");

    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-motif");
    const [, data] = vi.mocked(AiDesignerProjectRepository.update).mock.calls[0];
    expect(data).toMatchObject({ embellishmentMotifAttachmentId: null });
  });
});

describe("applyEmbellishments", () => {
  it("requires a design to already exist", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: null }) as never
    );

    await expect(applyEmbellishments(actor, "proj-1", { embellishmentType: "DIGITAL_APPLIQUE" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("requires at least a motif image or non-empty instructions", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        embellishmentMotifAttachmentId: null,
      }) as never
    );

    await expect(
      applyEmbellishments(actor, "proj-1", { embellishmentType: "DIGITAL_APPLIQUE", instructions: "   " })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("with a motif image, composes via provider.applyFabric (MULTI_FABRIC) and bumps a new version", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        embellishmentMotifAttachmentId: "att-motif",
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockImplementation(async (_companyId: string, id: string) => ({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from(id),
    }) as never);
    const applyFabric = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("composed"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generate: vi.fn(), applyFabric } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-embellished" }] as never);
    vi.mocked(AiDesignerVersionRepository.count).mockResolvedValue(1);
    vi.mocked(AiDesignerVersionRepository.create).mockResolvedValue({ id: "version-2", versionNumber: 2 } as never);

    const result = await applyEmbellishments(actor, "proj-1", {
      embellishmentType: "EMBROIDERY",
      instructions: "Add embroidery on the sleeves",
    });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "MULTI_FABRIC" }));
    expect(applyFabric).toHaveBeenCalledWith(
      expect.objectContaining({
        baseImage: { buffer: Buffer.from("att-parent"), mimeType: "image/png" },
        swatchImage: { buffer: Buffer.from("att-motif"), mimeType: "image/png" },
      })
    );
    expect(result.version.versionNumber).toBe(2);
  });

  it("with instructions only (no motif image), edits via provider.generateVariation (IMAGE_EDIT)", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        embellishmentMotifAttachmentId: null,
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("parent") } as never);
    const generateVariation = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("edited"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generate: vi.fn(), generateVariation } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-embellished" }] as never);
    vi.mocked(AiDesignerVersionRepository.count).mockResolvedValue(1);
    vi.mocked(AiDesignerVersionRepository.create).mockResolvedValue({ id: "version-2", versionNumber: 2 } as never);

    const result = await applyEmbellishments(actor, "proj-1", {
      embellishmentType: "SEQUIN_WORK",
      instructions: "Apply sequins in a floral pattern on the bodice",
    });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "IMAGE_EDIT" }));
    expect(generateVariation).toHaveBeenCalledWith(
      expect.objectContaining({ parentImage: { buffer: Buffer.from("parent"), mimeType: "image/png" } })
    );
    expect(result.version.versionNumber).toBe(2);
  });

  it("throws a clean error when the configured provider has no applyFabric capability (motif path)", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
        embellishmentMotifAttachmentId: "att-motif",
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      await params.call({ name: "cloudflare", model: "flux-1-schnell", generate: vi.fn() } as never);
      throw new Error("unreachable");
    });

    await expect(applyEmbellishments(actor, "proj-1", { embellishmentType: "DIGITAL_APPLIQUE" })).rejects.toThrow(
      /does not support applying an embellishment motif/
    );
  });
});

describe("generateTechPack", () => {
  it("requires a design to already exist", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject({ currentVersion: null }) as never);

    await expect(generateTechPack(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  const fakePart1 = { identification: { brandName: { value: "Acme", status: "CONFIRMED" } }, seamCallouts: [] } as never;
  const fakePart2 = { fabricMaterials: [], bomItems: [{ materialType: "Fabric" }], measurementPoints: [] } as never;
  const fakePart3 = { productionInstructions: [], qcCheckpoints: [] } as never;
  const fakePart4 = {
    assumptionsAndMissingData: [],
    additionalReferenceImagesRequired: [{ viewNeeded: "Back flat-lay", reason: "improves rear seam visibility" }],
    designerNotes: "Confirm sleeve length.",
  };

  it("runs the 4-call pipeline (Part 1 vision, Parts 2+3 concurrent text, then Part 4) plus a concurrent technical-flat image call — pages 1/2/5 get the real photo, pages 1/2/5/6 additionally get the generated flat", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        productCategory: "Dress",
        currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-real-photo" } },
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockResolvedValue({ data: fakePart2, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart3).mockResolvedValue({ data: fakePart3, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart4).mockResolvedValue({ data: fakePart4, model: "claude-sonnet-5" } as never);
    vi.mocked(AiDesignerTechPackRepository.markSuccess).mockResolvedValue({ id: "techpack-1", status: "SUCCESS" } as never);
    const generateTechnicalFlat = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("flat"), mimeType: "image/png" }], model: "test-model", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "Test Provider", model: "test-model", generate: vi.fn(), generateTechnicalFlat } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "p-1", providerName: "Test Provider" };
    });
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-flat-1" } as never);

    const result = await generateTechPack(actor, "proj-1");

    expect(generateGarmentAnalysisPart1).toHaveBeenCalledTimes(1);
    expect(generateGarmentAnalysisPart2).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1 }));
    expect(generateGarmentAnalysisPart3).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1 }));
    expect(generateGarmentAnalysisPart4).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1, part2: fakePart2, part3: fakePart3 }));
    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "TECHNICAL_FLAT", aiDesignerProjectId: "proj-1" }));
    expect(uploadAttachment).toHaveBeenCalledWith(actor, "AI_DESIGNER_PROJECT", "proj-1", expect.objectContaining({ mimeType: "image/png" }), "TECH_PACK_TECHNICAL_FLAT");

    expect(AiDesignerTechPackRepository.markSuccess).toHaveBeenCalledWith(
      "techpack-1",
      expect.objectContaining({
        designerNotes: fakePart4.designerNotes,
        suggestedAdditionalViews: "Back flat-lay — improves rear seam visibility",
        pages: expect.arrayContaining([
          expect.objectContaining({ pageNumber: 1, pageTitle: "Cover Page / Style Summary", imageAttachmentId: "att-real-photo", technicalFlatAttachmentId: "att-flat-1" }),
          expect.objectContaining({ pageNumber: 2, imageAttachmentId: "att-real-photo", technicalFlatAttachmentId: "att-flat-1" }),
          expect.objectContaining({ pageNumber: 5, imageAttachmentId: "att-real-photo", technicalFlatAttachmentId: "att-flat-1" }),
          // Page 6 (Measurements) gets no photo (never did), but DOES get the flat.
          expect.objectContaining({ pageNumber: 6, imageAttachmentId: null, technicalFlatAttachmentId: "att-flat-1" }),
          // Page 3 (Fabric & Materials), 4 (BOM), 7 (Size Grading) get neither image.
          expect.objectContaining({ pageNumber: 3, imageAttachmentId: null, technicalFlatAttachmentId: null }),
          expect.objectContaining({ pageNumber: 4, imageAttachmentId: null, technicalFlatAttachmentId: null }),
          expect.objectContaining({ pageNumber: 7, imageAttachmentId: null, technicalFlatAttachmentId: null }),
        ]),
      })
    );
    const [, successArgs] = vi.mocked(AiDesignerTechPackRepository.markSuccess).mock.calls[0];
    expect((successArgs.pages as unknown[]).length).toBe(12);

    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ completedSteps: expect.arrayContaining(["TECH_PACK"]) })
    );
    expect(result.status).toBe("SUCCESS");
  });

  it("gracefully falls back to no technical flat when the image provider is unavailable — the tech pack still generates successfully using the plain photo", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-real-photo" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockResolvedValue({ data: fakePart2, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart3).mockResolvedValue({ data: fakePart3, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart4).mockResolvedValue({ data: fakePart4, model: "claude-sonnet-5" } as never);
    vi.mocked(AiDesignerTechPackRepository.markSuccess).mockResolvedValue({ id: "techpack-1", status: "SUCCESS" } as never);
    vi.mocked(runWithFailover).mockRejectedValue(new BusinessRuleError("AI_SERVICE_ERROR", "No configured AI provider currently supports technical flat sketch generation."));

    const result = await generateTechPack(actor, "proj-1");

    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(AiDesignerTechPackRepository.markSuccess).toHaveBeenCalledWith(
      "techpack-1",
      expect.objectContaining({
        pages: expect.arrayContaining([
          expect.objectContaining({ pageNumber: 1, imageAttachmentId: "att-real-photo", technicalFlatAttachmentId: null }),
          expect.objectContaining({ pageNumber: 6, imageAttachmentId: null, technicalFlatAttachmentId: null }),
        ]),
      })
    );
    expect(result.status).toBe("SUCCESS");
  });

  it("marks the run FAILED, not partially successful, when the vision analysis call fails (even though the concurrent technical-flat attempt still fires)", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockRejectedValue(new Error("Anthropic call failed"));

    await expect(generateTechPack(actor, "proj-1")).rejects.toThrow();

    expect(generateGarmentAnalysisPart2).not.toHaveBeenCalled();
    expect(generateGarmentAnalysisPart3).not.toHaveBeenCalled();
    expect(generateGarmentAnalysisPart4).not.toHaveBeenCalled();
    expect(AiDesignerTechPackRepository.markFailed).toHaveBeenCalledWith("techpack-1", expect.stringContaining("Anthropic call failed"));
    expect(AiDesignerTechPackRepository.markSuccess).not.toHaveBeenCalled();
  });

  it("marks the run FAILED, not partially successful, when one of the concurrent Part 2/3 text calls fails", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockRejectedValue(new Error("Anthropic call failed"));
    vi.mocked(generateGarmentAnalysisPart3).mockResolvedValue({ data: fakePart3, model: "claude-sonnet-5" } as never);
    vi.mocked(runWithFailover).mockRejectedValue(new BusinessRuleError("AI_SERVICE_ERROR", "unavailable"));

    await expect(generateTechPack(actor, "proj-1")).rejects.toThrow();

    expect(generateGarmentAnalysisPart4).not.toHaveBeenCalled();
    expect(AiDesignerTechPackRepository.markFailed).toHaveBeenCalledWith("techpack-1", expect.stringContaining("Anthropic call failed"));
    expect(AiDesignerTechPackRepository.markSuccess).not.toHaveBeenCalled();
  });

  it("marks the run FAILED, not partially successful, when the final Part 4 review call fails", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockResolvedValue({ data: fakePart2, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart3).mockResolvedValue({ data: fakePart3, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart4).mockRejectedValue(new Error("Anthropic call failed"));
    vi.mocked(runWithFailover).mockRejectedValue(new BusinessRuleError("AI_SERVICE_ERROR", "unavailable"));

    await expect(generateTechPack(actor, "proj-1")).rejects.toThrow();

    expect(AiDesignerTechPackRepository.markFailed).toHaveBeenCalledWith("techpack-1", expect.stringContaining("Anthropic call failed"));
    expect(AiDesignerTechPackRepository.markSuccess).not.toHaveBeenCalled();
  });
});

describe("exportTechPackPdf", () => {
  it("requires a successful tech pack before downloading", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue(null as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a tech pack that hasn't succeeded yet", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({ status: "FAILED", pages: [] } as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a tech pack with no garment analysis data", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({ status: "SUCCESS", garmentAnalysisJson: null, pages: [] } as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires the project to exist", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(null as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fetches only the real images that exist (some pages legitimately have none) and combines everything into one downloadable PDF", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({
      status: "SUCCESS",
      createdAt: new Date("2026-09-13T10:00:00Z"),
      garmentAnalysisJson: { part1: { identification: {} }, part2: { bomItems: [] } },
      designerNotes: "Confirm sleeve length.",
      suggestedAdditionalViews: "A back flat-lay would help.",
      pages: [
        { pageNumber: 1, pageTitle: "Cover Page / Style Summary", imageAttachmentId: "att-page-1" },
        { pageNumber: 3, pageTitle: "Bill of Materials / BOM", imageAttachmentId: null },
      ],
    } as never);
    vi.mocked(getAttachmentForDownload).mockImplementation(
      async (_companyId: string, attachmentId: string) => ({ attachment: { mimeType: "image/png" }, buffer: Buffer.from(attachmentId) }) as never
    );

    const result = await exportTechPackPdf(actor, "proj-1");

    expect(getAttachmentForDownload).toHaveBeenCalledWith("co-1", "att-page-1");
    expect(getAttachmentForDownload).toHaveBeenCalledTimes(1); // page 3 has no image — never fetched
    expect(result.mimeType).toBe("application/pdf");
    expect(result.fileName).toBe("AID-2026-00001-tech-pack.pdf");
    expect(result.buffer.toString()).toBe("tech-pack-pdf");
  });

  it("dedupes repeated attachment fetches when multiple pages share the same real photo id", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({
      status: "SUCCESS",
      createdAt: new Date("2026-09-14T10:00:00Z"),
      garmentAnalysisJson: { part1: { identification: {} }, part2: { bomItems: [] } },
      designerNotes: null,
      suggestedAdditionalViews: null,
      pages: [
        { pageNumber: 1, pageTitle: "Cover Page / Style Summary", imageAttachmentId: "att-shared-photo" },
        { pageNumber: 2, pageTitle: "Construction & Detail Callouts", imageAttachmentId: "att-shared-photo" },
        { pageNumber: 4, pageTitle: "Colorways & Artwork Placement", imageAttachmentId: "att-shared-photo" },
        { pageNumber: 3, pageTitle: "Bill of Materials / BOM", imageAttachmentId: null },
      ],
    } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("photo") } as never);

    await exportTechPackPdf(actor, "proj-1");

    // Three pages share the exact same attachment id -- fetched once, not three times.
    expect(getAttachmentForDownload).toHaveBeenCalledTimes(1);
    expect(getAttachmentForDownload).toHaveBeenCalledWith("co-1", "att-shared-photo");
  });

  it("prefers the technical flat over the plain photo for Page 1/4, but Page 2 ALWAYS uses the plain photo (the image the seam-callout positions were estimated against)", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({
      status: "SUCCESS",
      createdAt: new Date("2026-09-20T10:00:00Z"),
      garmentAnalysisJson: { part1: { identification: {} }, part2: { bomItems: [] } },
      designerNotes: null,
      suggestedAdditionalViews: null,
      pages: [
        { pageNumber: 1, pageTitle: "Cover Page / Style Summary", imageAttachmentId: "att-photo", technicalFlatAttachmentId: "att-flat" },
        { pageNumber: 2, pageTitle: "Construction & Detail Callouts", imageAttachmentId: "att-photo", technicalFlatAttachmentId: "att-flat" },
        { pageNumber: 4, pageTitle: "Colorways & Artwork Placement", imageAttachmentId: "att-photo", technicalFlatAttachmentId: "att-flat" },
        { pageNumber: 5, pageTitle: "Measurements & Spec Table", imageAttachmentId: null, technicalFlatAttachmentId: "att-flat" },
        { pageNumber: 3, pageTitle: "Bill of Materials / BOM", imageAttachmentId: null, technicalFlatAttachmentId: null },
      ],
    } as never);
    vi.mocked(getAttachmentForDownload).mockImplementation(
      async (_companyId: string, attachmentId: string) => ({ attachment: { mimeType: "image/png" }, buffer: Buffer.from(attachmentId) }) as never
    );

    const { renderTechPackDocumentPdfV2 } = await import("@/core/ai-designer/export/tech-pack-pdf");
    await exportTechPackPdf(actor, "proj-1");

    const [callArgs] = vi.mocked(renderTechPackDocumentPdfV2).mock.calls[vi.mocked(renderTechPackDocumentPdfV2).mock.calls.length - 1];
    const images = callArgs.images as { pageNumber: number; imageBase64: string }[];
    const byPage = new Map(images.map((i) => [i.pageNumber, i.imageBase64]));
    expect(byPage.get(1)).toBe(Buffer.from("att-flat").toString("base64"));
    expect(byPage.get(2)).toBe(Buffer.from("att-photo").toString("base64")); // never the flat
    expect(byPage.get(4)).toBe(Buffer.from("att-flat").toString("base64"));
    expect(byPage.get(5)).toBe(Buffer.from("att-flat").toString("base64"));
    expect(byPage.has(3)).toBe(false);
  });
});

describe("updateTechPackField", () => {
  function techPackRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "techpack-1",
      companyId: "co-1",
      projectId: "proj-1",
      approvalStatus: "DRAFT",
      revisionNumber: 1,
      createdByUserId: "user-1",
      designerNotes: "notes",
      suggestedAdditionalViews: "views",
      garmentAnalysisJson: {
        part1: {
          identification: { brandName: { value: "Acme", status: "CONFIRMED" } },
          construction: {},
          closure: { closureType: { value: "Zipper", status: "CONFIRMED" }, closureDetails: { value: "", status: "NOT_VISIBLE" } },
          seamCallouts: [{ calloutNumber: 1, location: "Shoulder", technicalSpecification: "Overlock", status: "PROPOSED" }],
          visibleColors: [],
          suggestedColorways: [],
          artworkItems: [],
          artworkSummary: "",
          patternPrintType: "",
          patternPrintNotes: "",
        },
        part2: {
          fabricMaterials: [],
          bomItems: [],
          measurementPoints: [
            { pointName: "Chest", howToMeasure: "x", toleranceCm: "1", status: "CONFIRMED", values: { XS: "40", S: "42", M: "44", L: "46", XL: "48", XXL: "50" } },
          ],
          gradeRulesNotes: "",
        },
        part3: {
          productionInstructions: [],
          qcCheckpoints: [],
          mainLabelSpec: { value: "old label", status: "PROPOSED" },
          sizeLabelSpec: { value: "", status: "TBC" },
          careLabelSpec: { value: "", status: "TBC" },
          polybagSpec: { value: "", status: "TBC" },
          foldingInstructions: "",
          cartonPackingSpec: { value: "", status: "TBC" },
          hangtagSpec: { value: "", status: "TBC" },
          barcodeType: { value: "", status: "TBC" },
          barcodeContent: { value: "", status: "TBC" },
          barcodePlacement: { value: "", status: "TBC" },
        },
        part4: {
          assumptionsAndMissingData: [],
          additionalReferenceImagesRequired: [],
          designerNotes: "",
        },
      },
      originalGarmentAnalysisJson: null,
      pages: [{ pageNumber: 1, pageTitle: "Cover Page / Style Summary", promptText: null, imageAttachmentId: "att-1" }],
      ...overrides,
    };
  }

  it("edits a {value,status}-shaped field's own value (identification.brandName) in place while DRAFT", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1" } as never);

    const result = await updateTechPackField(actor, "proj-1", "techpack-1", {
      category: "identification",
      field: "brandName",
      subfield: "value",
      value: "New Brand",
    });

    expect(AiDesignerTechPackRepository.createRevision).not.toHaveBeenCalled();
    const [id, data] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[0];
    expect(id).toBe("techpack-1");
    const identification = (data.garmentAnalysisJson as never as { part1: { identification: { brandName: { value: string; status: string } } } })
      .part1.identification.brandName;
    expect(identification.value).toBe("New Brand");
    expect(identification.status).toBe("CONFIRMED"); // untouched -- only "value" was edited
    expect(result.forkedNewRevision).toBe(false);
  });

  it("edits a {value,status}-shaped field's own status independently of its value, via subfield \"status\"", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1" } as never);

    await updateTechPackField(actor, "proj-1", "techpack-1", { category: "identification", field: "brandName", subfield: "status", value: "TBC" });

    const [, data] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[0];
    const identification = (data.garmentAnalysisJson as never as { part1: { identification: { brandName: { value: string; status: string } } } })
      .part1.identification.brandName;
    expect(identification.status).toBe("TBC");
    expect(identification.value).toBe("Acme"); // untouched -- only "status" was edited
  });

  it("rejects an invalid status value", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);

    await expect(
      updateTechPackField(actor, "proj-1", "techpack-1", { category: "identification", field: "brandName", subfield: "status", value: "MAYBE" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerTechPackRepository.update).not.toHaveBeenCalled();
  });

  it("edits an array-row's own bare status (seamCallouts) via field \"status\"", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1" } as never);

    await updateTechPackField(actor, "proj-1", "techpack-1", { category: "seamCallouts", index: 0, field: "technicalSpecification", value: "Coverstitch" });
    await updateTechPackField(actor, "proj-1", "techpack-1", { category: "seamCallouts", index: 0, field: "status", value: "CONFIRMED" });

    const [, data] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[1];
    const callout = (data.garmentAnalysisJson as never as { part1: { seamCallouts: { technicalSpecification: string; status: string }[] } }).part1
      .seamCallouts[0];
    expect(callout.status).toBe("CONFIRMED");
  });

  it("edits a measurement point's own per-size cell via field \"values.<SIZE>\", and its row-level status via field \"status\"", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1" } as never);

    await updateTechPackField(actor, "proj-1", "techpack-1", { category: "measurementPoints", index: 0, field: "values.M", value: "45" });
    await updateTechPackField(actor, "proj-1", "techpack-1", { category: "measurementPoints", index: 0, field: "status", value: "TBC" });

    const [, cellData] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[0];
    expect(
      (cellData.garmentAnalysisJson as never as { part2: { measurementPoints: { values: Record<string, string> }[] } }).part2.measurementPoints[0]
        .values.M
    ).toBe("45");
    const [, statusData] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[1];
    expect((statusData.garmentAnalysisJson as never as { part2: { measurementPoints: { status: string }[] } }).part2.measurementPoints[0].status).toBe(
      "TBC"
    );
  });

  it("edits a Part 3 {value,status} scalar category (mainLabelSpec) directly on part3 by field-less category addressing", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1" } as never);

    await updateTechPackField(actor, "proj-1", "techpack-1", { category: "mainLabelSpec", subfield: "value", value: "new label" });

    const [, data] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[0];
    const mainLabelSpec = (data.garmentAnalysisJson as never as { part3: { mainLabelSpec: { value: string; status: string } } }).part3.mainLabelSpec;
    expect(mainLabelSpec.value).toBe("new label");
    expect(mainLabelSpec.status).toBe("PROPOSED"); // untouched
  });

  it("rejects an unknown field name", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);

    await expect(
      updateTechPackField(actor, "proj-1", "techpack-1", { category: "identification", field: "notARealField", value: "x" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerTechPackRepository.update).not.toHaveBeenCalled();
  });

  it("rejects an out-of-bounds array index", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(techPackRow() as never);

    await expect(
      updateTechPackField(actor, "proj-1", "techpack-1", { category: "seamCallouts", index: 99, field: "location", value: "x" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerTechPackRepository.update).not.toHaveBeenCalled();
  });

  it("forks a brand-new revision instead of mutating an already-APPROVED tech pack, and applies the edit to the new row", async () => {
    const approved = techPackRow({ approvalStatus: "APPROVED", revisionNumber: 1 });
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue(approved as never);
    const forkedRow = techPackRow({ id: "techpack-2", approvalStatus: "DRAFT", revisionNumber: 2 });
    vi.mocked(AiDesignerTechPackRepository.createRevision).mockResolvedValue(forkedRow as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-2", revisionNumber: 2 } as never);

    const result = await updateTechPackField(actor, "proj-1", "techpack-1", { category: "mainLabelSpec", subfield: "value", value: "revised label" });

    expect(AiDesignerTechPackRepository.createRevision).toHaveBeenCalledWith(expect.objectContaining({ id: "techpack-1", revisionNumber: 1 }));
    // The edit is applied to the NEW (forked) row, never the original approved one.
    const [updatedId] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[0];
    expect(updatedId).toBe("techpack-2");
    expect(result.forkedNewRevision).toBe(true);
    // The original approved row's own garmentAnalysisJson object is never mutated in place.
    expect((approved.garmentAnalysisJson as { part3: { mainLabelSpec: { value: string } } }).part3.mainLabelSpec.value).toBe("old label");
  });
});

describe("approveTechPack", () => {
  it("requires a successfully generated tech pack", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue({ id: "techpack-1", projectId: "proj-1", status: "FAILED" } as never);

    await expect(approveTechPack(actor, "proj-1", "techpack-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(PermissionService.assert).not.toHaveBeenCalled();
  });

  it("asserts the self-approval-guarded permission and sets approvalStatus/approvedByUserId/approvedAt", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue({
      id: "techpack-1",
      projectId: "proj-1",
      status: "SUCCESS",
      approvalStatus: "DRAFT",
      createdByUserId: "creator-1",
    } as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1", approvalStatus: "APPROVED" } as never);

    await approveTechPack(actor, "proj-1", "techpack-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "ai_designer", "approve", { createdBy: "creator-1" });
    const [, data] = vi.mocked(AiDesignerTechPackRepository.update).mock.calls[0];
    expect(data).toMatchObject({ approvalStatus: "APPROVED", approvedByUserId: "user-1" });
    expect(data.approvedAt).toBeInstanceOf(Date);
  });

  it("propagates a self-approval rejection from PermissionService without approving", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue({
      id: "techpack-1",
      projectId: "proj-1",
      status: "SUCCESS",
      approvalStatus: "DRAFT",
      createdByUserId: "user-1",
    } as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));

    await expect(approveTechPack(actor, "proj-1", "techpack-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(AiDesignerTechPackRepository.update).not.toHaveBeenCalled();
  });
});

describe("revertTechPackToOriginal", () => {
  it("restores garmentAnalysisJson from the frozen originalGarmentAnalysisJson snapshot", async () => {
    const original = { part1: { identification: { brandName: "Original Brand" } } };
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue({
      id: "techpack-1",
      projectId: "proj-1",
      approvalStatus: "DRAFT",
      originalGarmentAnalysisJson: original,
    } as never);
    vi.mocked(AiDesignerTechPackRepository.update).mockResolvedValue({ id: "techpack-1" } as never);

    await revertTechPackToOriginal(actor, "proj-1", "techpack-1");

    expect(AiDesignerTechPackRepository.update).toHaveBeenCalledWith("techpack-1", { garmentAnalysisJson: original });
  });

  it("is blocked once the tech pack is already approved", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue({
      id: "techpack-1",
      projectId: "proj-1",
      approvalStatus: "APPROVED",
      originalGarmentAnalysisJson: {},
    } as never);

    await expect(revertTechPackToOriginal(actor, "proj-1", "techpack-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(AiDesignerTechPackRepository.update).not.toHaveBeenCalled();
  });

  it("rejects when there is no AI-generated original to revert to", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findByIdScoped).mockResolvedValue({
      id: "techpack-1",
      projectId: "proj-1",
      approvalStatus: "DRAFT",
      originalGarmentAnalysisJson: null,
    } as never);

    await expect(revertTechPackToOriginal(actor, "proj-1", "techpack-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

// ---------------------------------------------------------------------------
// Sketch / Drawing → Garment (2026-09-20)
// ---------------------------------------------------------------------------

function readySketchProject(overrides: Record<string, unknown> = {}) {
  return readyProjectWithFabricImage({
    creationMode: "SKETCH",
    sketchImageAttachmentId: "att-sketch-photo",
    ...overrides,
  });
}

describe("uploadSketchImage / deleteSketchImage", () => {
  it("uploads a sketch and marks any existing analysis STALE", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ creationMode: "SKETCH" }) as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-sketch-photo" } as never);

    await uploadSketchImage(actor, "proj-1", { buffer: Buffer.from("sketch"), fileName: "sketch.png", mimeType: "image/png" });

    expect(uploadAttachment).toHaveBeenCalledWith(actor, "AI_DESIGNER_PROJECT", "proj-1", expect.anything(), "SKETCH_IMAGE");
    expect(AiDesignerSketchAnalysisRepository.markStale).toHaveBeenCalledWith("proj-1");
    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ sketchImageAttachmentId: "att-sketch-photo" })
    );
  });

  it("rejects a non-image file type", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ creationMode: "SKETCH" }) as never);

    await expect(
      uploadSketchImage(actor, "proj-1", { buffer: Buffer.from("not-an-image"), fileName: "sketch.pdf", mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("deletes the sketch and marks any existing analysis STALE", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ creationMode: "SKETCH", sketchImageAttachmentId: "att-sketch-photo" }) as never
    );

    await deleteSketchImage(actor, "proj-1");

    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-sketch-photo");
    expect(AiDesignerSketchAnalysisRepository.markStale).toHaveBeenCalledWith("proj-1");
    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", expect.objectContaining({ sketchImageAttachmentId: null }));
  });

  it("rejects deleting when no sketch was ever uploaded", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ creationMode: "SKETCH" }) as never);

    await expect(deleteSketchImage(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(deleteAttachment).not.toHaveBeenCalled();
  });
});

describe("runSketchAnalysis", () => {
  it("blocks running analysis with no sketch uploaded", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ creationMode: "SKETCH" }) as never);

    await expect(runSketchAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(analyzeSketch).not.toHaveBeenCalled();
  });

  it("blocks a second analysis while one is already in progress", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ creationMode: "SKETCH", sketchImageAttachmentId: "att-sketch-photo" }) as never
    );
    vi.mocked(AiDesignerSketchAnalysisRunRepository.findActiveSince).mockResolvedValue({ id: "run-active" } as never);

    await expect(runSketchAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("runs the real vision analysis and persists 21 observations, each starting equal to the AI's own value and locked", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ creationMode: "SKETCH", sketchImageAttachmentId: "att-sketch-photo" }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from("sketch-bytes"),
    } as never);
    const observationOutput = { observation: "Round neckline, as drawn.", confidence: "CONFIRMED_VISUALLY" };
    vi.mocked(analyzeSketch).mockResolvedValue({
      data: {
        garmentType: observationOutput,
        silhouette: observationOutput,
        length: observationOutput,
        fit: observationOutput,
        frontNeckline: observationOutput,
        backNeckline: observationOutput,
        sleeveType: observationOutput,
        sleeveLength: observationOutput,
        collar: observationOutput,
        shoulderConstruction: observationOutput,
        waistConstruction: observationOutput,
        closureDetails: observationOutput,
        pockets: observationOutput,
        panelsAndYokes: observationOutput,
        pleatsAndGathers: observationOutput,
        dartsAndSeams: observationOutput,
        slitsAndOpenings: observationOutput,
        ruffleAndLayerDetails: observationOutput,
        hemAndCuffs: observationOutput,
        decorativeDetails: observationOutput,
        otherConstructionNotes: observationOutput,
        sketchAnalysisSummary: "A simple round-neck frock, knee length.",
      },
      model: "claude-opus-5",
      rawResponse: {},
    } as never);
    vi.mocked(AiDesignerSketchAnalysisRepository.upsertWithObservations).mockResolvedValue({ id: "sketch-analysis-1" } as never);

    await runSketchAnalysis(actor, "proj-1");

    const [, , observations] = vi.mocked(AiDesignerSketchAnalysisRepository.upsertWithObservations).mock.calls[0];
    expect(observations).toHaveLength(21);
    expect(observations.every((o: { approvedObservation: string; aiObservation: string; isLocked?: boolean; userEdited?: boolean }) =>
      o.approvedObservation === o.aiObservation && o.isLocked === true && o.userEdited === false
    )).toBe(true);
    expect(AiDesignerSketchAnalysisRunRepository.markSuccess).toHaveBeenCalledWith("sketch-run-1", "sketch-analysis-1");
  });

  it("marks the run FAILED and never persists an analysis on a real AI failure", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ creationMode: "SKETCH", sketchImageAttachmentId: "att-sketch-photo" }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(analyzeSketch).mockRejectedValue(new Error("provider down"));

    await expect(runSketchAnalysis(actor, "proj-1")).rejects.toThrow();
    expect(AiDesignerSketchAnalysisRunRepository.markFailed).toHaveBeenCalledWith("sketch-run-1", "UNKNOWN", "provider down");
    expect(AiDesignerSketchAnalysisRepository.upsertWithObservations).not.toHaveBeenCalled();
  });
});

describe("updateSketchObservation / resetSketchObservationToAi / setSketchObservationLock / approveSketchAnalysis", () => {
  it("edit re-opens an APPROVED analysis to UNDER_REVIEW and preserves the AI's own original value", async () => {
    vi.mocked(AiDesignerSketchObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysisId: "sketch-analysis-1",
      featureKey: "frontNeckline",
      aiObservation: "Round neckline.",
      approvedObservation: "Round neckline.",
      analysis: { companyId: "co-1", status: "APPROVED" },
    } as never);

    await updateSketchObservation(actor, "obs-1", { approvedObservation: "V-neck (buyer requested)" });

    expect(AiDesignerSketchObservationRepository.update).toHaveBeenCalledWith("obs-1", {
      approvedObservation: "V-neck (buyer requested)",
      userEdited: true,
    });
    expect(AiDesignerSketchAnalysisRepository.update).toHaveBeenCalledWith("sketch-analysis-1", { status: "UNDER_REVIEW" });
  });

  it("rejects editing an observation belonging to a different company", async () => {
    vi.mocked(AiDesignerSketchObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysis: { companyId: "co-OTHER", status: "APPROVED" },
    } as never);

    await expect(updateSketchObservation(actor, "obs-1", { approvedObservation: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reset restores the AI's own original value and clears userEdited", async () => {
    vi.mocked(AiDesignerSketchObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      aiObservation: "Round neckline.",
      analysis: { companyId: "co-1" },
    } as never);

    await resetSketchObservationToAi(actor, "obs-1");

    expect(AiDesignerSketchObservationRepository.update).toHaveBeenCalledWith("obs-1", {
      approvedObservation: "Round neckline.",
      userEdited: false,
    });
  });

  it("lock toggle has no re-approval side effect", async () => {
    vi.mocked(AiDesignerSketchObservationRepository.findWithAnalysisOwner).mockResolvedValue({
      id: "obs-1",
      analysis: { companyId: "co-1", status: "APPROVED" },
    } as never);

    await setSketchObservationLock(actor, "obs-1", { isLocked: false });

    expect(AiDesignerSketchObservationRepository.update).toHaveBeenCalledWith("obs-1", { isLocked: false });
    expect(AiDesignerSketchAnalysisRepository.update).not.toHaveBeenCalled();
  });

  it("approve bulk-stamps the header and every observation", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ creationMode: "SKETCH" }) as never);
    vi.mocked(AiDesignerSketchAnalysisRepository.findByProjectId).mockResolvedValue({ id: "sketch-analysis-1", status: "AI_ANALYSED" } as never);

    await approveSketchAnalysis(actor, "proj-1");

    expect(AiDesignerSketchAnalysisRepository.approveAllObservations).toHaveBeenCalledWith("sketch-analysis-1", "user-1");
  });

  it("rejects approving an analysis that doesn't exist yet", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ creationMode: "SKETCH" }) as never);
    vi.mocked(AiDesignerSketchAnalysisRepository.findByProjectId).mockResolvedValue(null);

    await expect(approveSketchAnalysis(actor, "proj-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("detectDesignOverrides", () => {
  const observations = [
    { featureKey: "frontNeckline", approvedObservation: "Round neckline.", isLocked: true },
    { featureKey: "sleeveType", approvedObservation: "Full-length fitted sleeve.", isLocked: true },
    { featureKey: "pleatsAndGathers", approvedObservation: "Light gathers at the waist.", isLocked: true },
  ];

  it("treats a Product Design selection differing from a locked, mapped sketch feature as an explicit override", () => {
    const { overrides, overriddenFeatureKeys } = detectDesignOverrides(observations, { neckline: "V Neck" });

    expect(overrides).toEqual([{ featureLabel: "Front Neckline", sketchValue: "Round neckline.", selectedValue: "V Neck" }]);
    expect(overriddenFeatureKeys.has("frontNeckline")).toBe(true);
  });

  it("a sketch feature with no mapped Product Design attribute is never treated as overridden (safe default: sketch wins)", () => {
    const { overrides, overriddenFeatureKeys } = detectDesignOverrides(observations, { anything: "whatever" });

    expect(overrides.find((o) => o.featureLabel.includes("Pleats"))).toBeUndefined();
    expect(overriddenFeatureKeys.has("pleatsAndGathers")).toBe(false);
  });

  it("an unlocked observation is never treated as overridden even if a matching selection exists", () => {
    const { overrides } = detectDesignOverrides(
      [{ featureKey: "frontNeckline", approvedObservation: "Round neckline.", isLocked: false }],
      { neckline: "V Neck" }
    );

    expect(overrides).toEqual([]);
  });

  it("no selections at all means no overrides", () => {
    const { overrides, overriddenFeatureKeys } = detectDesignOverrides(observations, null);

    expect(overrides).toEqual([]);
    expect(overriddenFeatureKeys.size).toBe(0);
  });
});

describe("generateDesign — SKETCH mode", () => {
  it("blocks generation with a sketch uploaded but no APPROVED analysis", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readySketchProject() as never);
    vi.mocked(AiDesignerSketchAnalysisRepository.findByProjectId).mockResolvedValue({ id: "sketch-analysis-1", status: "AI_ANALYSED" } as never);

    await expect(generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerPromptRepository.create).not.toHaveBeenCalled();
  });

  it("sends the sketch as referenceImage and the fabric as materialImage to provider.replicateWithNewMaterial, honouring an explicit Product Design override", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      readySketchProject({ designSelectionsJson: { neckline: "V Neck" } }) as never
    );
    vi.mocked(AiDesignerSketchAnalysisRepository.findByProjectId).mockResolvedValue({
      id: "sketch-analysis-1",
      status: "APPROVED",
      observations: [
        { featureKey: "frontNeckline", approvedObservation: "Round neckline.", isLocked: true },
        { featureKey: "sleeveType", approvedObservation: "Full-length fitted sleeve.", isLocked: true },
      ],
    } as never);
    const sketchBytes = Buffer.from("SKETCH-BYTES");
    const fabricBytes = Buffer.from("FABRIC-BYTES");
    vi.mocked(getAttachmentForDownload).mockImplementation((async (_companyId: string, attachmentId: string) =>
      attachmentId === "att-sketch-photo"
        ? { attachment: { mimeType: "image/png" }, buffer: sketchBytes }
        : { attachment: { mimeType: "image/jpeg" }, buffer: fabricBytes }) as never);
    const replicateWithNewMaterial = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("generated"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    const generateFromFabricReference = vi.fn();
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generateFromFabricReference, replicateWithNewMaterial } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }] as never);

    await generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "DESIGN_REPLICATION", aiDesignerProjectId: "proj-1" }));
    expect(replicateWithNewMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImage: { buffer: sketchBytes, mimeType: "image/png" },
        materialImage: { buffer: fabricBytes, mimeType: "image/jpeg" },
      })
    );
    const promptText = vi.mocked(replicateWithNewMaterial).mock.calls[0][0].prompt as string;
    // Tier 1 (explicit override) is honoured — the sketch's own front-neckline
    // value is named as overridden, not silently preserved.
    expect(promptText).toContain('Change Front Neckline to "V Neck"');
    expect(promptText).toContain('the sketch itself shows "Round neckline."');
    // Tier 2 — the un-overridden locked feature is still preserved.
    expect(promptText).toContain("Sleeve Type: Full-length fitted sleeve.");
    // The STANDARD-mode-only provider method must never be called for a sketch project.
    expect(generateFromFabricReference).not.toHaveBeenCalled();
  });

  it("throws a clean UNSUPPORTED_OPERATION-mapped error when the configured provider has no design-replication capability", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readySketchProject() as never);
    vi.mocked(AiDesignerSketchAnalysisRepository.findByProjectId).mockResolvedValue({ id: "sketch-analysis-1", status: "APPROVED", observations: [] } as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      try {
        await params.call({ name: "cloudflare", model: "flux-1-schnell", generate: vi.fn() } as never);
        throw new Error("test setup error: should have thrown UNSUPPORTED_OPERATION");
      } catch (err) {
        throw new BusinessRuleError("AI_SERVICE_ERROR", err instanceof Error ? err.message : "failed");
      }
    });

    await expect(generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiDesignerImageRepository.createMany).not.toHaveBeenCalled();
  });

  it("a STANDARD-mode project still calls generateFromFabricReference unchanged (zero regression)", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readyProjectWithFabricImage() as never);
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/jpeg" }, buffer: FABRIC_IMAGE_BYTES } as never);
    const generateFromFabricReference = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("generated"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} });
    const replicateWithNewMaterial = vi.fn();
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generateFromFabricReference, replicateWithNewMaterial } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }] as never);

    await generateDesign(actor, "proj-1", { imageCount: 1, viewAngle: "FRONT" });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "FABRIC_REFERENCE" }));
    expect(generateFromFabricReference).toHaveBeenCalled();
    expect(replicateWithNewMaterial).not.toHaveBeenCalled();
    expect(AiDesignerSketchAnalysisRepository.findByProjectId).not.toHaveBeenCalled();
  });
});

describe("runProductSuggestions", () => {
  it("requires fabric characteristics to already be recorded", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ fabricName: null }) as never);

    await expect(runProductSuggestions(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerPromptRepository.create).not.toHaveBeenCalled();
  });

  it("blocks a concurrent run while one is already in progress", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ fabricName: "Cotton Poplin" }) as never);
    vi.mocked(AiDesignerPromptRepository.findActiveSince).mockResolvedValue({ id: "prompt-active" } as never);

    await expect(runProductSuggestions(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("stores the validated result and marks the step complete on success", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      baseProject({ fabricName: "Cotton Poplin", fabricComposition: "100% Cotton" }) as never
    );
    const data = {
      groups: [{ targetCustomer: "WOMEN", items: [{ productCategory: "Kurti", priorityRank: 1, ageGroup: "25-40", environmentKey: "STUDIO_WHITE", reasoning: "Good drape" }] }],
      overallSummary: "Great for Women's kurtis.",
    };
    vi.mocked(generateProductSuggestions).mockResolvedValue({ data, model: "claude-sonnet-5", rawResponse: {} } as never);

    const updated = await runProductSuggestions(actor, "proj-1");

    expect(generateProductSuggestions).toHaveBeenCalledWith(expect.objectContaining({ fabricName: "Cotton Poplin", composition: "100% Cotton" }));
    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ productSuggestionsJson: data, completedSteps: expect.arrayContaining(["PRODUCT_SUGGESTIONS"]) })
    );
    expect(updated).toMatchObject({ productSuggestionsJson: data });
    expect(AiDesignerPromptRepository.markSuccessWithProvider).toHaveBeenCalledWith("prompt-1", "anthropic", "claude-sonnet-5");
  });

  it("marks the prompt row FAILED and rethrows on a real AI failure, never persisting a partial result", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ fabricName: "Cotton Poplin" }) as never);
    vi.mocked(generateProductSuggestions).mockRejectedValue(new Error("provider down"));

    await expect(runProductSuggestions(actor, "proj-1")).rejects.toThrow();
    expect(AiDesignerPromptRepository.markFailed).toHaveBeenCalledWith("prompt-1", "UNKNOWN", "provider down");
    expect(AiDesignerProjectRepository.update).not.toHaveBeenCalled();
  });
});

describe("getProductSuggestions", () => {
  it("returns null when nothing has been generated yet", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ productSuggestionsJson: null }) as never);
    await expect(getProductSuggestions("co-1", "proj-1")).resolves.toBeNull();
  });

  it("returns the stored suggestions once generated", async () => {
    const data = { groups: [], overallSummary: "x" };
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ productSuggestionsJson: data }) as never);
    await expect(getProductSuggestions("co-1", "proj-1")).resolves.toEqual(data);
  });
});

describe("applyProductSuggestionAndGenerate", () => {
  function projectWithSuggestions(overrides: Record<string, unknown> = {}) {
    return readyProjectWithFabricImage({
      productSuggestionsJson: {
        groups: [
          {
            targetCustomer: "WOMEN",
            items: [
              { productCategory: "Kurti", priorityRank: 1, ageGroup: "25-40", environmentKey: "STUDIO_WHITE", reasoning: "Good drape" },
              { productCategory: "Dress", priorityRank: 2, ageGroup: "18-25", environmentKey: "BEACH", reasoning: "Also nice" },
            ],
          },
        ],
      },
      // Pre-set to match the suggestion being applied -- the mocked
      // findAnyById returns one static object across every call this
      // function makes (it doesn't simulate real intermediate persistence),
      // so generateDesign()'s own internal assertReadyToGenerate() needs
      // these fields already correct.
      targetCustomer: "WOMEN",
      ageGroup: "25-40",
      productCategory: "Kurti",
      environmentLabel: "Studio White",
      environmentKey: "STUDIO_WHITE",
      ...overrides,
    });
  }

  function mockSuccessfulGeneration() {
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/jpeg" }, buffer: Buffer.from("fabric") } as never);
    const generateFromFabricReference = vi
      .fn()
      .mockResolvedValue({
        images: [
          { buffer: Buffer.from("a"), mimeType: "image/png" },
          { buffer: Buffer.from("b"), mimeType: "image/png" },
          { buffer: Buffer.from("c"), mimeType: "image/png" },
        ],
        model: "gpt-image-1",
        raw: {},
      });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "openai", model: "gpt-image-1", generateFromFabricReference } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "openai" };
    });
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }, { id: "img-2" }, { id: "img-3" }] as never);
  }

  it("throws a clean error when the suggestion index doesn't exist -- never trusts client-submitted category/age-group values directly", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(projectWithSuggestions() as never);

    await expect(applyProductSuggestionAndGenerate(actor, "proj-1", { groupIndex: 5, itemIndex: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerPromptRepository.create).not.toHaveBeenCalled();
  });

  it("throws a clean error when no suggestions have ever been generated for this project", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readyProjectWithFabricImage({ productSuggestionsJson: null }) as never);

    await expect(applyProductSuggestionAndGenerate(actor, "proj-1", { groupIndex: 0, itemIndex: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("applies the exact suggested item (by position, not client-trusted values) and generates 3 images tagged fromSuggestion", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(projectWithSuggestions() as never);
    mockSuccessfulGeneration();

    const result = await applyProductSuggestionAndGenerate(actor, "proj-1", { groupIndex: 0, itemIndex: 0 });

    // saveWizardSelections() was called with the AI's own exact item, never
    // a client-submitted value.
    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ targetCustomer: "WOMEN", ageGroup: "25-40", productCategory: "Kurti", environmentKey: "STUDIO_WHITE" })
    );
    expect(result.images).toEqual([
      { id: "img-1", fromSuggestion: true },
      { id: "img-2", fromSuggestion: true },
      { id: "img-3", fromSuggestion: true },
    ]);
    expect(result.appliedSuggestion).toEqual({ targetCustomer: "WOMEN", ageGroup: "25-40", productCategory: "Kurti", environmentKey: "STUDIO_WHITE" });
  });

  it("applies the second item in the group correctly, distinct from the first", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      projectWithSuggestions({ targetCustomer: "WOMEN", ageGroup: "18-25", productCategory: "Dress", environmentLabel: "Beach", environmentKey: "BEACH" }) as never
    );
    mockSuccessfulGeneration();

    const result = await applyProductSuggestionAndGenerate(actor, "proj-1", { groupIndex: 0, itemIndex: 1 });

    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ targetCustomer: "WOMEN", ageGroup: "18-25", productCategory: "Dress", environmentKey: "BEACH" })
    );
    expect(result.appliedSuggestion.productCategory).toBe("Dress");
  });
});

describe("Branding", () => {
  // A real, minimal 1x1 PNG (same fixture exportProject's own tests use) --
  // sharp() runs unmocked against real bytes here, same precedent as the
  // exportProject describe block above.
  const REAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const REAL_PNG = Buffer.from(REAL_PNG_BASE64, "base64");

  describe("updateBrandName", () => {
    it("stores the new brand name and audit-logs the old/new value", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ brandName: null }) as never);

      await updateBrandName(actor, "proj-1", { brandName: "Acme Fashions" });

      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { brandName: "Acme Fashions" });
    });

    it("clears the brand name back to null on an empty string", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ brandName: "Old Name" }) as never);

      await updateBrandName(actor, "proj-1", { brandName: "" });

      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { brandName: null });
    });
  });

  describe("uploadBrandLogo", () => {
    it("sets a sensible default position/size the first time a logo is uploaded", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
        baseProject({ brandLogoAttachmentId: null, logoXPercent: null, logoYPercent: null, logoWidthPercent: null }) as never
      );
      vi.mocked(uploadAttachment).mockResolvedValue({ id: "logo-att-1" } as never);

      await uploadBrandLogo(actor, "proj-1", { buffer: REAL_PNG, fileName: "logo.png", mimeType: "image/png" });

      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ brandLogoAttachmentId: "logo-att-1", logoXPercent: 70, logoYPercent: 80, logoWidthPercent: 20 })
      );
    });

    it("keeps the existing position/size on a re-upload replacing an existing logo", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
        baseProject({ brandLogoAttachmentId: "old-logo", logoXPercent: 10, logoYPercent: 15, logoWidthPercent: 30 }) as never
      );
      vi.mocked(uploadAttachment).mockResolvedValue({ id: "logo-att-2" } as never);

      await uploadBrandLogo(actor, "proj-1", { buffer: REAL_PNG, fileName: "logo.png", mimeType: "image/png" });

      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ brandLogoAttachmentId: "logo-att-2", logoXPercent: 10, logoYPercent: 15, logoWidthPercent: 30 })
      );
    });

    it("rejects an unsupported file type", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);

      await expect(
        uploadBrandLogo(actor, "proj-1", { buffer: REAL_PNG, fileName: "logo.svg", mimeType: "image/svg+xml" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(uploadAttachment).not.toHaveBeenCalled();
    });
  });

  describe("deleteBrandLogo", () => {
    it("requires a logo to already exist", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ brandLogoAttachmentId: null }) as never);

      await expect(deleteBrandLogo(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("deletes both the logo and any prior branded composite, clearing both columns", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(
        baseProject({ brandLogoAttachmentId: "logo-1", brandedImageAttachmentId: "branded-1" }) as never
      );

      await deleteBrandLogo(actor, "proj-1");

      expect(deleteAttachment).toHaveBeenCalledWith(actor, "logo-1");
      expect(deleteAttachment).toHaveBeenCalledWith(actor, "branded-1");
      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { brandLogoAttachmentId: null, brandedImageAttachmentId: null });
    });
  });

  describe("updateLogoPosition", () => {
    it("requires a logo to already be uploaded", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ brandLogoAttachmentId: null }) as never);

      await expect(updateLogoPosition(actor, "proj-1", { logoXPercent: 10, logoYPercent: 10, logoWidthPercent: 20 })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("stores the new position/size", async () => {
      vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject({ brandLogoAttachmentId: "logo-1" }) as never);

      await updateLogoPosition(actor, "proj-1", { logoXPercent: 40, logoYPercent: 50, logoWidthPercent: 25 });

      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { logoXPercent: 40, logoYPercent: 50, logoWidthPercent: 25 });
    });
  });

  describe("applyBranding", () => {
    it("requires a generated design to exist first", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject({ currentVersion: null }) as never);

      await expect(applyBranding(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("requires a logo to already be uploaded", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
        baseProject({
          currentVersion: { currentImage: { imageAttachmentId: "design-1" } },
          brandLogoAttachmentId: null,
        }) as never
      );

      await expect(applyBranding(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("composites the real logo onto the real design image and stores the result as a new attachment, replacing any prior one", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
        baseProject({
          currentVersion: { currentImage: { imageAttachmentId: "design-1" } },
          brandLogoAttachmentId: "logo-1",
          brandedImageAttachmentId: "old-branded-1",
          logoXPercent: 70,
          logoYPercent: 80,
          logoWidthPercent: 20,
        }) as never
      );
      vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: REAL_PNG } as never);
      vi.mocked(uploadAttachment).mockResolvedValue({ id: "branded-2" } as never);

      const result = await applyBranding(actor, "proj-1");

      // The old branded composite is deleted before the new one is uploaded.
      expect(deleteAttachment).toHaveBeenCalledWith(actor, "old-branded-1");
      // A real PNG-magic-byte buffer was genuinely produced by sharp, not a
      // placeholder -- confirms the composite actually ran.
      expect(uploadAttachment).toHaveBeenCalledWith(
        actor,
        "AI_DESIGNER_PROJECT",
        "proj-1",
        expect.objectContaining({ mimeType: "image/png", buffer: expect.any(Buffer) }),
        "BRANDED_DESIGN_IMAGE"
      );
      const uploadedBuffer = vi.mocked(uploadAttachment).mock.calls[0][3].buffer as Buffer;
      expect(uploadedBuffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ brandedImageAttachmentId: "branded-2" })
      );
      expect(result.attachment.id).toBe("branded-2");
    });

    it("clamps an out-of-range logo width to the allowed [5,60] range rather than crashing", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
        baseProject({
          currentVersion: { currentImage: { imageAttachmentId: "design-1" } },
          brandLogoAttachmentId: "logo-1",
          brandedImageAttachmentId: null,
          logoXPercent: 70,
          logoYPercent: 80,
          logoWidthPercent: 999,
        }) as never
      );
      vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: REAL_PNG } as never);
      vi.mocked(uploadAttachment).mockResolvedValue({ id: "branded-3" } as never);

      await expect(applyBranding(actor, "proj-1")).resolves.toMatchObject({ attachment: { id: "branded-3" } });
      expect(deleteAttachment).not.toHaveBeenCalled();
    });

    // Real bug caught live: sharp/libvips throws a low-level decode error
    // (not a BusinessRuleError) for a structurally corrupt image file,
    // which without this guard surfaced as a raw 500 rather than a clean,
    // actionable message.
    it("maps a corrupt/undecodable logo file to a clean validation error, never a raw crash", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
        baseProject({
          currentVersion: { currentImage: { imageAttachmentId: "design-1" } },
          brandLogoAttachmentId: "logo-1",
          brandedImageAttachmentId: null,
          logoXPercent: 70,
          logoYPercent: 80,
          logoWidthPercent: 20,
        }) as never
      );
      vi.mocked(getAttachmentForDownload).mockImplementation(((_companyId: string, attachmentId: string) =>
        Promise.resolve(
          attachmentId === "logo-1"
            ? { attachment: { mimeType: "image/png" }, buffer: Buffer.from("not a real png") }
            : { attachment: { mimeType: "image/png" }, buffer: REAL_PNG }
        )) as never);

      await expect(applyBranding(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(uploadAttachment).not.toHaveBeenCalled();
    });
  });

  describe("getBrandDefaults", () => {
    it("resolves to the project's own brandName when set", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
        baseProject({ brandName: "My Own Brand", company: { name: "Real Company Name" } }) as never
      );

      await expect(getBrandDefaults("co-1", "proj-1")).resolves.toEqual({ effectiveBrandName: "My Own Brand" });
    });

    it("falls back to the real company name when brandName is unset -- never a hardcoded default", async () => {
      vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
        baseProject({ brandName: null, company: { name: "Indradhar Garments Pvt. Ltd." } }) as never
      );

      await expect(getBrandDefaults("co-1", "proj-1")).resolves.toEqual({ effectiveBrandName: "Indradhar Garments Pvt. Ltd." });
    });
  });
});

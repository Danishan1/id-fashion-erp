import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentMetadata: vi.fn(),
}));
vi.mock("@/core/ai-designer/fabric-analysis/analyze", () => ({ analyzeFabric: vi.fn() }));
vi.mock("@/core/ai/provider-manager/AIProviderManager", () => ({ runWithFailover: vi.fn() }));
vi.mock("@/core/ai-designer/export/tech-pack-pdf", () => ({
  renderTechPackPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  renderTechPackDocumentPdf: vi.fn().mockResolvedValue(Buffer.from("tech-pack-pdf")),
}));
vi.mock("@/core/ai-designer/tech-pack/generate", () => ({
  generateGarmentAnalysisPart1: vi.fn(),
  generateGarmentAnalysisPart2: vi.fn(),
  generatePagePrompts: vi.fn(),
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
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { uploadAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { runWithFailover } = await import("@/core/ai/provider-manager/AIProviderManager");
const { generateGarmentAnalysisPart1, generateGarmentAnalysisPart2, generatePagePrompts } = await import("@/core/ai-designer/tech-pack/generate");
const { ProductRepository } = await import("@/modules/products/product.repository");
const {
  AiDesignerProjectRepository,
  AiDesignerPromptRepository,
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerVersionRepository,
  AiDesignerTechPackRepository,
} = await import("./ai-designer.repository");
const {
  createProject,
  selectExistingFabric,
  uploadFabricImage,
  generateDesign,
  generateEditPreview,
  applyEditVariation,
  approveCurrentVersion,
  rejectCurrentVersion,
  applySecondFabric,
  generateTechPack,
  exportTechPackPdf,
  decideImage,
  listImages,
  exportProject,
} = await import("./ai-designer.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    companyId: "co-1",
    projectNumber: "AID-2026-00001",
    projectName: "Test Project",
    status: "DRAFT",
    currentStep: "FABRIC_SELECTION",
    completedSteps: [] as string[],
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
  vi.mocked(runWithFailover).mockReset();
  vi.mocked(AiDesignerTechPackRepository.create).mockReset().mockResolvedValue({ id: "techpack-1" } as never);
  vi.mocked(AiDesignerTechPackRepository.markSuccess).mockReset();
  vi.mocked(AiDesignerTechPackRepository.markFailed).mockReset();
  vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockReset();
  vi.mocked(generateGarmentAnalysisPart1).mockReset();
  vi.mocked(generateGarmentAnalysisPart2).mockReset();
  vi.mocked(generatePagePrompts).mockReset();
});

describe("createProject", () => {
  it("creates a DRAFT project with a real document number", async () => {
    vi.mocked(AiDesignerProjectRepository.create).mockResolvedValue(baseProject({ id: "proj-1" }) as never);

    const project = await createProject(actor, { projectName: "Summer Line" });

    expect(project.id).toBe("proj-1");
    expect(AiDesignerProjectRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "Summer Line", status: "DRAFT", currentStep: "FABRIC_SELECTION" })
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

    await expect(generateDesign(actor, "proj-1", { imageCount: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
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

    await expect(generateDesign(actor, "proj-1", { imageCount: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
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

    const result = await generateDesign(actor, "proj-1", { imageCount: 1 });

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

    await expect(generateDesign(actor, "proj-1", { imageCount: 1 })).rejects.toMatchObject({
      code: "AI_SERVICE_ERROR",
      message: expect.stringContaining("does not support generating a design from a fabric reference image"),
    });
    expect(AiDesignerImageRepository.createMany).not.toHaveBeenCalled();
  });

  it("blocks a second generation call while one is already in progress", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(readyProjectWithFabricImage() as never);
    vi.mocked(AiDesignerPromptRepository.findActiveSince).mockResolvedValue({ id: "prompt-active" } as never);

    await expect(generateDesign(actor, "proj-1", { imageCount: 1 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("generateEditPreview — Edit Design workspace, step 1", () => {
  it("requires a design to already exist before editing", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: null }) as never
    );

    await expect(
      generateEditPreview(actor, "proj-1", { mode: "QUICK", featureLabel: "Collar", currentValue: "Round Neck", newValue: "Mandarin Collar", imageCount: 1 })
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
      generateEditPreview(actor, "proj-1", { mode: "QUICK", featureLabel: "Collar", currentValue: "Round Neck", newValue: "Mandarin Collar", imageCount: 1 })
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

describe("generateTechPack", () => {
  it("requires a design to already exist", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(baseProject({ currentVersion: null }) as never);

    await expect(generateTechPack(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  const fakePart1 = { identification: { brandName: "Acme" }, seamCallouts: [] } as never;
  const fakePart2 = { bomItems: [{ materialType: "Fabric" }], measurementPoints: [] } as never;
  // Only 4 of the 7 pages need an image (1, 2, 4, 5 — see TECH_PACK_IMAGE_PAGE_DEFINITIONS);
  // pagePrompts is positional against THAT list, not all 7 pages.
  const fakePagePrompts = {
    pagePrompts: ["p1", "p2", "p4", "p5"],
    designerNotes: "Confirm sleeve length.",
    suggestedAdditionalViews: "A back flat-lay would help.",
  };

  it("runs the full pipeline — vision analysis, text analysis, page prompts, then only the 4 image-needing pages get a generated image", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        productCategory: "Dress",
        currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-1" } },
      }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockResolvedValue({ data: fakePart2, model: "claude-sonnet-5" } as never);
    vi.mocked(generatePagePrompts).mockResolvedValue({ data: fakePagePrompts, model: "claude-sonnet-5" } as never);
    const generateTechnicalFlat = vi
      .fn()
      .mockResolvedValue({ images: [{ buffer: Buffer.from("flat"), mimeType: "image/png" }], model: "flux-1-schnell", raw: {} });
    vi.mocked(runWithFailover).mockImplementation(async (params) => {
      const result = await params.call({ name: "cloudflare", model: "flux-1-schnell", generate: vi.fn(), generateTechnicalFlat } as never);
      return { images: result.images, model: result.model, raw: result.raw, providerId: "provider-1", providerName: "cloudflare" };
    });
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "page-attachment" } as never);
    vi.mocked(AiDesignerTechPackRepository.markSuccess).mockResolvedValue({ id: "techpack-1", status: "SUCCESS" } as never);

    const result = await generateTechPack(actor, "proj-1");

    expect(generateGarmentAnalysisPart1).toHaveBeenCalledTimes(1);
    expect(generateGarmentAnalysisPart2).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1 }));
    expect(generatePagePrompts).toHaveBeenCalledWith(expect.objectContaining({ part1: fakePart1, part2: fakePart2 }));
    // Only 4 image generation calls — pages 1, 2, 4, 5 — never 7.
    expect(runWithFailover).toHaveBeenCalledTimes(4);
    expect(generateTechnicalFlat).toHaveBeenCalledTimes(4);
    expect(generateTechnicalFlat).toHaveBeenNthCalledWith(1, expect.objectContaining({ prompt: "p1", count: 1 }));
    expect(generateTechnicalFlat).toHaveBeenNthCalledWith(4, expect.objectContaining({ prompt: "p5", count: 1 }));

    expect(AiDesignerTechPackRepository.markSuccess).toHaveBeenCalledWith(
      "techpack-1",
      expect.objectContaining({
        designerNotes: fakePagePrompts.designerNotes,
        suggestedAdditionalViews: fakePagePrompts.suggestedAdditionalViews,
        pages: expect.arrayContaining([
          expect.objectContaining({ pageNumber: 1, pageTitle: "Cover Page / Style Summary", promptText: "p1", imageAttachmentId: "page-attachment" }),
          // Page 3 (BOM) needs no image at all — real text/tables come from garmentAnalysisJson at PDF-render time instead.
          expect.objectContaining({ pageNumber: 3, imageAttachmentId: null }),
        ]),
      })
    );
    const [, successArgs] = vi.mocked(AiDesignerTechPackRepository.markSuccess).mock.calls[0];
    expect((successArgs.pages as unknown[]).length).toBe(7);
    expect((successArgs.pages as { imageAttachmentId: string | null }[]).filter((p) => p.imageAttachmentId).length).toBe(4);

    expect(AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ completedSteps: expect.arrayContaining(["TECH_PACK"]) })
    );
    expect(result.status).toBe("SUCCESS");
  });

  it("marks the run FAILED, not partially successful, when the vision analysis call fails", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockRejectedValue(new Error("Anthropic call failed"));

    await expect(generateTechPack(actor, "proj-1")).rejects.toThrow();

    expect(generateGarmentAnalysisPart2).not.toHaveBeenCalled();
    expect(generatePagePrompts).not.toHaveBeenCalled();
    expect(runWithFailover).not.toHaveBeenCalled();
    expect(AiDesignerTechPackRepository.markFailed).toHaveBeenCalledWith("techpack-1", expect.stringContaining("Anthropic call failed"));
    expect(AiDesignerTechPackRepository.markSuccess).not.toHaveBeenCalled();
  });

  it("marks the run FAILED and names the failing page when one of the 4 image generations fails", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-1" } } }) as never
    );
    vi.mocked(getAttachmentForDownload).mockResolvedValue({ attachment: { mimeType: "image/png" }, buffer: Buffer.from("x") } as never);
    vi.mocked(generateGarmentAnalysisPart1).mockResolvedValue({ data: fakePart1, model: "claude-sonnet-5" } as never);
    vi.mocked(generateGarmentAnalysisPart2).mockResolvedValue({ data: fakePart2, model: "claude-sonnet-5" } as never);
    vi.mocked(generatePagePrompts).mockResolvedValue({ data: fakePagePrompts, model: "claude-sonnet-5" } as never);
    let call = 0;
    vi.mocked(runWithFailover).mockImplementation(async () => {
      call += 1;
      // The 3rd image-needing page in fixed page-number order is page 4 (Colorways) — pages 1, 2, 4, 5 are the only ones that ever call runWithFailover.
      if (call === 3) throw new Error("Provider rate-limited.");
      return { images: [{ buffer: Buffer.from("flat"), mimeType: "image/png" }], model: "flux-1-schnell", raw: {}, providerId: "p1", providerName: "cloudflare" };
    });

    await expect(generateTechPack(actor, "proj-1")).rejects.toThrow();

    expect(AiDesignerTechPackRepository.markFailed).toHaveBeenCalledWith(
      "techpack-1",
      expect.stringContaining("Page 4 (Colorways & Artwork Placement): Provider rate-limited.")
    );
    expect(AiDesignerTechPackRepository.markSuccess).not.toHaveBeenCalled();
  });
});

describe("exportTechPackPdf", () => {
  it("requires a successful tech pack before downloading", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue(null as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a tech pack that hasn't succeeded yet", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({ status: "FAILED", pages: [] } as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a tech pack with no garment analysis data", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
    vi.mocked(AiDesignerTechPackRepository.findLatestByProjectId).mockResolvedValue({ status: "SUCCESS", garmentAnalysisJson: null, pages: [] } as never);

    await expect(exportTechPackPdf(actor, "proj-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("fetches only the real images that exist (some pages legitimately have none) and combines everything into one downloadable PDF", async () => {
    vi.mocked(AiDesignerProjectRepository.findAnyById).mockResolvedValue(baseProject() as never);
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
});

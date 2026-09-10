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
vi.mock("@/core/ai-designer/export/tech-pack-pdf", () => ({ renderTechPackPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")) }));
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
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { uploadAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { runWithFailover } = await import("@/core/ai/provider-manager/AIProviderManager");
const { ProductRepository } = await import("@/modules/products/product.repository");
const {
  AiDesignerProjectRepository,
  AiDesignerPromptRepository,
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerVersionRepository,
} = await import("./ai-designer.repository");
const {
  createProject,
  selectExistingFabric,
  uploadFabricImage,
  generateDesign,
  editDesign,
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
  vi.mocked(AiDesignerImageRepository.createMany).mockReset();
  vi.mocked(AiDesignerImageRepository.findByGenerationId).mockReset();
  vi.mocked(AiDesignerVersionRepository.create).mockReset().mockResolvedValue({ id: "version-1", versionNumber: 1 } as never);
  vi.mocked(AiDesignerVersionRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(uploadAttachment).mockReset().mockResolvedValue({ id: "attachment-1" } as never);
  vi.mocked(getAttachmentForDownload).mockReset();
  vi.mocked(runWithFailover).mockReset();
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

describe("editDesign", () => {
  it("requires a design to already exist before editing", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: null }) as never
    );

    await expect(
      editDesign(actor, "proj-1", { featureLabel: "Collar", currentValue: "Round Neck", newValue: "Mandarin Collar" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates version N+1 with the correct parentImageId/editedFeature", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({
        fabricName: "Cotton",
        currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } },
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
    vi.mocked(AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-edited" }] as never);
    vi.mocked(AiDesignerVersionRepository.count).mockResolvedValue(1);
    vi.mocked(AiDesignerVersionRepository.create).mockResolvedValue({ id: "version-2", versionNumber: 2 } as never);

    const result = await editDesign(actor, "proj-1", {
      featureLabel: "Collar",
      currentValue: "Round Neck",
      newValue: "Mandarin Collar",
    });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "IMAGE_EDIT" }));
    expect(AiDesignerGenerationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentImageId: "img-parent", editedFeature: "Collar" })
    );
    expect(AiDesignerVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ versionNumber: 2, currentImageId: "img-edited" })
    );
    expect(result.version.versionNumber).toBe(2);
  });

  it("blocks editing while an edit is already in progress", async () => {
    vi.mocked(AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(
      baseProject({ currentVersion: { currentImage: { id: "img-parent", imageAttachmentId: "att-parent" } } }) as never
    );
    vi.mocked(AiDesignerPromptRepository.findActiveSince).mockResolvedValue({ id: "prompt-active" } as never);

    await expect(
      editDesign(actor, "proj-1", { featureLabel: "Collar", currentValue: "Round Neck", newValue: "Mandarin Collar" })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
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

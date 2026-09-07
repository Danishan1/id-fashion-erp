import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
}));
vi.mock("@/core/ai/image-generation/factory", () => ({ getImageGenerationProvider: vi.fn() }));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findAnyById: vi.fn(), update: vi.fn() },
}));
vi.mock("./visual-generation.repository", () => ({
  AiGarmentGeneratedImageRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./design-variation.repository", () => ({
  AiGarmentDesignVariationRepository: { findByDesignDirectionId: vi.fn() },
}));
vi.mock("./ai-garment-project.service", () => ({ saveWorkflowStep: vi.fn() }));
vi.mock("./fabric-application.repository", () => ({
  AiGarmentFabricApplicationRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentFabricApplicationRepository: {
    create: vi.fn(),
    findByDesignDirectionId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    approveExclusive: vi.fn(),
  },
}));

const { uploadAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { getImageGenerationProvider } = await import("@/core/ai/image-generation/factory");
const { ImageGenConfigMissingError } = await import("@/core/ai/image-generation/config");
const { ImageGenerationServiceError } = await import("@/core/ai/image-generation/types");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentGeneratedImageRepository } = await import("./visual-generation.repository");
const { AiGarmentDesignVariationRepository } = await import("./design-variation.repository");
const { saveWorkflowStep } = await import("./ai-garment-project.service");
const { AiGarmentFabricApplicationRunRepository, AiGarmentFabricApplicationRepository } = await import("./fabric-application.repository");
const {
  createFabricApplication,
  listFabricApplications,
  decideFabricApplication,
  approveDesignAndFabric,
} = await import("./fabric-application.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: "dir-1",
  approvedFabricApplicationId: null,
};

const swatchFile = { buffer: Buffer.from("swatch"), fileName: "swatch.png", mimeType: "image/png" };

function mockProvider(overrides: { applyFabric?: ReturnType<typeof vi.fn> } = {}) {
  return { name: "openai", model: "gpt-image-1", generate: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentGeneratedImageRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([
    { imageAttachmentId: "img-selected", decision: "SELECTED", updatedAt: new Date("2026-01-01") },
    { imageAttachmentId: "img-other", decision: "PENDING", updatedAt: new Date("2026-01-02") },
  ]);
  (AiGarmentDesignVariationRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (AiGarmentFabricApplicationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentFabricApplicationRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (uploadAttachment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "attachment-1" });
  (getAttachmentForDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
    attachment: { mimeType: "image/png" },
    buffer: Buffer.from("base-bytes"),
  });
  (AiGarmentFabricApplicationRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "app-1" });
});

describe("createFabricApplication", () => {
  it("rejects a project with no design selected yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    await expect(createFabricApplication(actor, "proj-1", { swatchFile })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when no image or variation has been SELECTED for the chosen design", async () => {
    (AiGarmentGeneratedImageRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([
      { imageAttachmentId: "img-other", decision: "PENDING", updatedAt: new Date() },
    ]);
    await expect(createFabricApplication(actor, "proj-1", { swatchFile })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("picks whichever of an image or a variation was most recently SELECTED", async () => {
    (AiGarmentDesignVariationRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([
      { imageAttachmentId: "var-selected", decision: "SELECTED", updatedAt: new Date("2026-06-01") }, // newer than the image
    ]);
    const provider = mockProvider({
      applyFabric: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("r"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createFabricApplication(actor, "proj-1", { swatchFile });

    expect(AiGarmentFabricApplicationRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseImageAttachmentId: "var-selected" })
    );
  });

  it("rejects a swatch file that isn't jpg/png/webp", async () => {
    await expect(
      createFabricApplication(actor, "proj-1", { swatchFile: { ...swatchFile, mimeType: "application/pdf" } })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("rejects a second apply-fabric call while one is already in progress for this design", async () => {
    (AiGarmentFabricApplicationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(createFabricApplication(actor, "proj-1", { swatchFile })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ImageGenConfigMissingError("OPENAI_API_KEY is missing.");
    });

    await expect(createFabricApplication(actor, "proj-1", { swatchFile })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentFabricApplicationRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentFabricApplicationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentFabricApplicationRepository.create).not.toHaveBeenCalled();
  });

  it("logs a real FAILED run when the configured provider has no fabric-application capability", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockProvider()); // no applyFabric

    await expect(createFabricApplication(actor, "proj-1", { swatchFile })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentFabricApplicationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "UNSUPPORTED_OPERATION", expect.any(String));
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    const provider = mockProvider({ applyFabric: vi.fn().mockRejectedValue(new ImageGenerationServiceError("Timed out.", "TIMEOUT")) });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await expect(createFabricApplication(actor, "proj-1", { swatchFile })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentFabricApplicationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("sends both the base image and the swatch image to the provider, and includes the fields in the hidden prompt", async () => {
    const provider = mockProvider({
      applyFabric: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("r"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createFabricApplication(actor, "proj-1", {
      swatchFile,
      composition: "100% Cotton",
      gsm: "180",
      wovenOrKnit: "Knit",
    });

    expect(provider.applyFabric).toHaveBeenCalledWith({
      prompt: expect.stringContaining("100% Cotton"),
      count: 1,
      baseImage: { buffer: Buffer.from("base-bytes"), mimeType: "image/png" },
      swatchImage: { buffer: swatchFile.buffer, mimeType: "image/png" },
    });
    const prompt = (provider.applyFabric as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("180"); // gsm
    expect(prompt).toContain("Construction: Knit"); // woven/knit, appended outside the fixed 9-field template

    expect(uploadAttachment).toHaveBeenCalledWith(actor, "AI_GARMENT_PROJECT", "proj-1", swatchFile, "FABRIC_SWATCH_IMAGE");
    expect(AiGarmentFabricApplicationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseImageAttachmentId: "img-selected", swatchAttachmentId: "attachment-1", composition: "100% Cotton" })
    );
    expect(AiGarmentFabricApplicationRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("listFabricApplications", () => {
  it("returns an empty list, not an error, when no design has been selected yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    const result = await listFabricApplications("co-1", "proj-1");
    expect(result).toEqual([]);
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(listFabricApplications("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("decideFabricApplication", () => {
  const pendingApp = { id: "app-1", designDirectionId: "dir-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentFabricApplicationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingApp);
    (AiGarmentFabricApplicationRepository.approveExclusive as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "app-1", decision: "APPROVED" });
  });

  it("rejects an application that doesn't belong to this company", async () => {
    (AiGarmentFabricApplicationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingApp,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(decideFabricApplication(actor, "app-1", { decision: "APPROVE", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires explicit confirmation", async () => {
    await expect(decideFabricApplication(actor, "app-1", { decision: "APPROVE", confirmed: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentFabricApplicationRepository.approveExclusive).not.toHaveBeenCalled();
  });

  it("approves exclusively once confirmed", async () => {
    await decideFabricApplication(actor, "app-1", { decision: "APPROVE", confirmed: true });
    expect(AiGarmentFabricApplicationRepository.approveExclusive).toHaveBeenCalledWith("dir-1", "app-1");
  });
});

describe("approveDesignAndFabric", () => {
  const approvedApp = { id: "app-1", projectId: "proj-1", decision: "APPROVED", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentFabricApplicationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(approvedApp);
    (AiGarmentProjectRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "proj-1",
      approvedFabricApplicationId: "app-1",
    });
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(approveDesignAndFabric(actor, "proj-x", { fabricApplicationId: "app-1", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires explicit confirmation", async () => {
    await expect(approveDesignAndFabric(actor, "proj-1", { fabricApplicationId: "app-1", confirmed: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a fabric application that hasn't been approved yet", async () => {
    (AiGarmentFabricApplicationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedApp,
      decision: "PENDING",
    });
    await expect(approveDesignAndFabric(actor, "proj-1", { fabricApplicationId: "app-1", confirmed: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a fabric application belonging to a different project", async () => {
    (AiGarmentFabricApplicationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedApp,
      projectId: "other-proj",
    });
    await expect(approveDesignAndFabric(actor, "proj-1", { fabricApplicationId: "app-1", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("records the approved application and advances the workflow to TECHNICAL_DEVELOPMENT", async () => {
    await approveDesignAndFabric(actor, "proj-1", { fabricApplicationId: "app-1", confirmed: true });

    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ approvedFabricApplicationId: "app-1", approvedFabricApplicationByUserId: "user-1" })
    );
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(1, actor, "proj-1", { stepKey: "APPLY_FABRIC" });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "TECHNICAL_DEVELOPMENT" });
  });
});

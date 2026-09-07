import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
}));
vi.mock("@/core/ai/image-generation/factory", () => ({ getImageGenerationProvider: vi.fn() }));
vi.mock("./selected-garment-image", () => ({ resolveSelectedGarmentImage: vi.fn() }));
vi.mock("./fabric-application.repository", () => ({
  AiGarmentFabricApplicationRepository: { findWithProjectOwner: vi.fn() },
}));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findAnyById: vi.fn(), update: vi.fn() },
}));
vi.mock("./ai-garment-project.service", () => ({ saveWorkflowStep: vi.fn() }));
vi.mock("./technical-development.repository", () => ({
  AiGarmentTechnicalFlatRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentTechnicalFlatRepository: {
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
const { resolveSelectedGarmentImage } = await import("./selected-garment-image");
const { AiGarmentFabricApplicationRepository } = await import("./fabric-application.repository");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { saveWorkflowStep } = await import("./ai-garment-project.service");
const { AiGarmentTechnicalFlatRunRepository, AiGarmentTechnicalFlatRepository } = await import("./technical-development.repository");
const { createTechnicalFlat, listTechnicalFlats, decideTechnicalFlat, approveTechnicalFlat } = await import(
  "./technical-development.service"
);

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: "dir-1",
  approvedFabricApplicationId: null,
  approvedTechnicalFlatId: null,
};

const baseResolved = { project: baseProject, designDirectionId: "dir-1", baseImageAttachmentId: "img-selected" };

function mockProvider(overrides: { generateTechnicalFlat?: ReturnType<typeof vi.fn> } = {}) {
  return { name: "openai", model: "gpt-image-1", generate: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveSelectedGarmentImage as ReturnType<typeof vi.fn>).mockResolvedValue(baseResolved);
  (AiGarmentTechnicalFlatRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentTechnicalFlatRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (uploadAttachment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "attachment-1" });
  (getAttachmentForDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
    attachment: { mimeType: "image/png" },
    buffer: Buffer.from("base-bytes"),
  });
  (AiGarmentTechnicalFlatRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flat-1" });
});

describe("createTechnicalFlat", () => {
  it("propagates the underlying error when no design has been selected yet", async () => {
    (resolveSelectedGarmentImage as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("Select a design first"), { code: "VALIDATION_ERROR" })
    );
    await expect(createTechnicalFlat(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("falls back to the plain selected garment image when no fabric application has been approved", async () => {
    const provider = mockProvider({
      generateTechnicalFlat: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("r"), mimeType: "image/png" }], model: "m", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createTechnicalFlat(actor, "proj-1", {});

    expect(AiGarmentFabricApplicationRepository.findWithProjectOwner).not.toHaveBeenCalled();
    expect(AiGarmentTechnicalFlatRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseImageAttachmentId: "img-selected" })
    );
  });

  it("prefers an approved fabric application's result image over the plain selected garment image", async () => {
    (resolveSelectedGarmentImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseResolved,
      project: { ...baseProject, approvedFabricApplicationId: "app-1" },
    });
    (AiGarmentFabricApplicationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "app-1",
      resultImageAttachmentId: "img-fabric-applied",
      project: { id: "proj-1", companyId: "co-1" },
    });
    const provider = mockProvider({
      generateTechnicalFlat: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("r"), mimeType: "image/png" }], model: "m", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createTechnicalFlat(actor, "proj-1", {});

    expect(AiGarmentFabricApplicationRepository.findWithProjectOwner).toHaveBeenCalledWith("app-1");
    expect(AiGarmentTechnicalFlatRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseImageAttachmentId: "img-fabric-applied" })
    );
  });

  it("rejects a second create call while one is already in progress for this design", async () => {
    (AiGarmentTechnicalFlatRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(createTechnicalFlat(actor, "proj-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ImageGenConfigMissingError("OPENAI_API_KEY is missing.");
    });

    await expect(createTechnicalFlat(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentTechnicalFlatRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentTechnicalFlatRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentTechnicalFlatRepository.create).not.toHaveBeenCalled();
  });

  it("logs a real FAILED run when the configured provider has no technical-flat capability", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockProvider()); // no generateTechnicalFlat

    await expect(createTechnicalFlat(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentTechnicalFlatRunRepository.markFailed).toHaveBeenCalledWith("run-1", "UNSUPPORTED_OPERATION", expect.any(String));
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    const provider = mockProvider({ generateTechnicalFlat: vi.fn().mockRejectedValue(new ImageGenerationServiceError("Timed out.", "TIMEOUT")) });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await expect(createTechnicalFlat(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentTechnicalFlatRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("sends the base image and includes additionalNotes in the hidden prompt, on success", async () => {
    const provider = mockProvider({
      generateTechnicalFlat: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("r"), mimeType: "image/png" }], model: "m", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createTechnicalFlat(actor, "proj-1", { additionalNotes: "Show the back yoke seam" });

    expect(provider.generateTechnicalFlat).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Show the back yoke seam"),
      count: 1,
      baseImage: { buffer: Buffer.from("base-bytes"), mimeType: "image/png" },
    });
    expect(uploadAttachment).toHaveBeenCalledWith(
      actor,
      "AI_GARMENT_PROJECT",
      "proj-1",
      expect.objectContaining({ mimeType: "image/png" }),
      "TECHNICAL_FLAT_IMAGE"
    );
    expect(AiGarmentTechnicalFlatRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseImageAttachmentId: "img-selected", resultImageAttachmentId: "attachment-1" })
    );
    expect(AiGarmentTechnicalFlatRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("listTechnicalFlats", () => {
  it("returns an empty list, not an error, when no design has been selected yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    const result = await listTechnicalFlats("co-1", "proj-1");
    expect(result).toEqual([]);
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(listTechnicalFlats("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("decideTechnicalFlat", () => {
  const pendingFlat = { id: "flat-1", designDirectionId: "dir-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentTechnicalFlatRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingFlat);
    (AiGarmentTechnicalFlatRepository.approveExclusive as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "flat-1", decision: "APPROVED" });
  });

  it("rejects a flat that doesn't belong to this company", async () => {
    (AiGarmentTechnicalFlatRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingFlat,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(decideTechnicalFlat(actor, "flat-1", { decision: "APPROVE", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires explicit confirmation", async () => {
    await expect(decideTechnicalFlat(actor, "flat-1", { decision: "APPROVE", confirmed: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentTechnicalFlatRepository.approveExclusive).not.toHaveBeenCalled();
  });

  it("approves exclusively once confirmed", async () => {
    await decideTechnicalFlat(actor, "flat-1", { decision: "APPROVE", confirmed: true });
    expect(AiGarmentTechnicalFlatRepository.approveExclusive).toHaveBeenCalledWith("dir-1", "flat-1");
  });
});

describe("approveTechnicalFlat", () => {
  const approvedFlat = { id: "flat-1", projectId: "proj-1", decision: "APPROVED", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
    (AiGarmentTechnicalFlatRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(approvedFlat);
    (AiGarmentProjectRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "proj-1",
      approvedTechnicalFlatId: "flat-1",
    });
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(approveTechnicalFlat(actor, "proj-x", { technicalFlatId: "flat-1", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires explicit confirmation", async () => {
    await expect(approveTechnicalFlat(actor, "proj-1", { technicalFlatId: "flat-1", confirmed: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a technical flat that hasn't been approved yet", async () => {
    (AiGarmentTechnicalFlatRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedFlat,
      decision: "PENDING",
    });
    await expect(approveTechnicalFlat(actor, "proj-1", { technicalFlatId: "flat-1", confirmed: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a technical flat belonging to a different project", async () => {
    (AiGarmentTechnicalFlatRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedFlat,
      projectId: "other-proj",
    });
    await expect(approveTechnicalFlat(actor, "proj-1", { technicalFlatId: "flat-1", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("records the approved flat and advances the workflow to BOM", async () => {
    await approveTechnicalFlat(actor, "proj-1", { technicalFlatId: "flat-1", confirmed: true });

    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ approvedTechnicalFlatId: "flat-1", approvedTechnicalFlatByUserId: "user-1" })
    );
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(1, actor, "proj-1", { stepKey: "TECHNICAL_DEVELOPMENT" });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "BOM" });
  });

  it("advances a FABRIC-sourced project (no APPLY_FABRIC step) to BOM the same way", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, sourceType: "FABRIC" });
    await approveTechnicalFlat(actor, "proj-1", { technicalFlatId: "flat-1", confirmed: true });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "BOM" });
  });
});

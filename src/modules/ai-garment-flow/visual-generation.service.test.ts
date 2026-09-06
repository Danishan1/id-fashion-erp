import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
}));
vi.mock("@/core/ai/image-generation/factory", () => ({ getImageGenerationProvider: vi.fn() }));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findWithProjectOwner: vi.fn(), findById: vi.fn() },
  AiGarmentDevelopmentBriefRunRepository: { findById: vi.fn() },
}));
vi.mock("./visual-generation.repository", () => ({
  AiGarmentImageGenerationRunRepository: {
    create: vi.fn(),
    findActiveSince: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  },
  AiGarmentGeneratedImageRepository: {
    createMany: vi.fn(),
    findByDesignDirectionId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    update: vi.fn(),
  },
}));

const { uploadAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { getImageGenerationProvider } = await import("@/core/ai/image-generation/factory");
const { ImageGenConfigMissingError } = await import("@/core/ai/image-generation/config");
const { ImageGenerationServiceError } = await import("@/core/ai/image-generation/types");
const { AiGarmentDesignDirectionRepository, AiGarmentDevelopmentBriefRunRepository } = await import("./development-brief.repository");
const { AiGarmentImageGenerationRunRepository, AiGarmentGeneratedImageRepository } = await import("./visual-generation.repository");
const { generateVisuals, createVariation, listGeneratedImages, decideImage, updateImageNotes } = await import("./visual-generation.service");

const actor = { companyId: "co-1", userId: "user-1" };

const approvedDirection = {
  id: "dir-1",
  projectId: "proj-1",
  developmentBriefRunId: "run-1",
  status: "APPROVED",
  silhouette: "Boxy",
  fit: "Relaxed",
  garmentLength: "Hip",
  neckline: "Crew",
  collar: "None",
  sleeve: "Short",
  shoulderConstruction: "Dropped",
  frontConstruction: "Plain",
  backConstruction: "Plain",
  closure: "Pullover",
  pocket: "None",
  waistTreatment: "Straight hem",
  hem: "Straight",
  keyNewDesignFeature: "Contrast placket",
  suggestedFabricCharacter: "Lightweight cotton poplin",
  targetConsumer: "Young professionals",
  commercialClassification: "BALANCED",
  project: { id: "proj-1", companyId: "co-1" },
};

const briefRun = {
  id: "run-1",
  contextSnapshotJson: { garmentCategory: "Shirt", targetMarket: "USA", season: "Spring 2027" },
};

function mockProvider(overrides: { generate?: ReturnType<typeof vi.fn>; generateVariation?: ReturnType<typeof vi.fn> } = {}) {
  return {
    name: "openai",
    model: "gpt-image-1",
    generate: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("img"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(approvedDirection);
  (AiGarmentDevelopmentBriefRunRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(briefRun);
  (AiGarmentImageGenerationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentImageGenerationRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "gen-run-1" });
  (uploadAttachment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "attachment-1" });
  (AiGarmentGeneratedImageRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "img-1" }]);
});

describe("generateVisuals", () => {
  it("rejects a direction that doesn't exist in this company", async () => {
    (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(generateVisuals(actor, "dir-x", { imageCount: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a direction that is not APPROVED", async () => {
    (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedDirection,
      status: "GENERATED",
    });
    await expect(generateVisuals(actor, "dir-1", { imageCount: 1 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a second generate call while one is already in progress for the same direction", async () => {
    (AiGarmentImageGenerationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(generateVisuals(actor, "dir-1", { imageCount: 1 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ImageGenConfigMissingError("OPENAI_API_KEY is missing.");
    });

    await expect(generateVisuals(actor, "dir-1", { imageCount: 3 })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentImageGenerationRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentImageGenerationRunRepository.markFailed).toHaveBeenCalledWith("gen-run-1", "MISSING_CONFIG", expect.any(String));
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    const provider = mockProvider({
      generate: vi.fn().mockRejectedValue(new ImageGenerationServiceError("Timed out.", "TIMEOUT")),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await expect(generateVisuals(actor, "dir-1", { imageCount: 1 })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentImageGenerationRunRepository.markFailed).toHaveBeenCalledWith("gen-run-1", "TIMEOUT", expect.any(String));
  });

  it("saves every returned image as its own attachment + row, using the prompt built from the direction's own approved fields", async () => {
    const provider = mockProvider({
      generate: vi.fn().mockResolvedValue({
        images: [
          { buffer: Buffer.from("a"), mimeType: "image/png" },
          { buffer: Buffer.from("b"), mimeType: "image/png" },
          { buffer: Buffer.from("c"), mimeType: "image/png" },
        ],
        model: "gpt-image-1",
        raw: {},
      }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    const result = await generateVisuals(actor, "dir-1", { imageCount: 3 });

    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ count: 3, prompt: expect.stringContaining("Boxy") }));
    expect(provider.generate.mock.calls[0][0].prompt).toContain("Shirt"); // category, from the brief run's context snapshot
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
    expect(AiGarmentGeneratedImageRepository.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ designDirectionId: "dir-1", generationRunId: "gen-run-1", imageAttachmentId: "attachment-1" })])
    );
    expect(AiGarmentImageGenerationRunRepository.markSuccess).toHaveBeenCalledWith("gen-run-1");
    expect(result).toEqual([{ id: "img-1" }]);
  });
});

describe("createVariation", () => {
  const parentImage = {
    id: "img-parent",
    designDirectionId: "dir-1",
    imageAttachmentId: "attachment-parent",
    decision: "PENDING",
    project: { id: "proj-1", companyId: "co-1" },
  };

  beforeEach(() => {
    (AiGarmentGeneratedImageRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(parentImage);
    (getAttachmentForDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
      attachment: { mimeType: "image/png" },
      buffer: Buffer.from("parent-bytes"),
    });
  });

  it("logs a real FAILED run when the configured provider has no image-to-image capability", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockProvider()); // no generateVariation

    await expect(createVariation(actor, "img-parent", { imageCount: 1 })).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentImageGenerationRunRepository.markFailed).toHaveBeenCalledWith("gen-run-1", "UNSUPPORTED_OPERATION", expect.any(String));
  });

  it("sends the parent image's real bytes to the provider and records the lineage on the run", async () => {
    const provider = mockProvider({
      generateVariation: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("v"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createVariation(actor, "img-parent", { imageCount: 1 });

    expect(provider.generateVariation).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, parentImage: { buffer: Buffer.from("parent-bytes"), mimeType: "image/png" } })
    );
    expect(AiGarmentImageGenerationRunRepository.create).toHaveBeenCalledWith(expect.objectContaining({ parentGeneratedImageId: "img-parent" }));
  });
});

describe("listGeneratedImages", () => {
  it("rejects a direction that doesn't belong to this company", async () => {
    (AiGarmentDesignDirectionRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedDirection,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(listGeneratedImages("co-1", "dir-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("decideImage", () => {
  const pendingImage = { id: "img-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentGeneratedImageRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingImage);
    (AiGarmentGeneratedImageRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "img-1", decision: "SELECTED" });
  });

  it("requires explicit confirmation to SELECT an image", async () => {
    await expect(decideImage(actor, "img-1", { decision: "SELECT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiGarmentGeneratedImageRepository.update).not.toHaveBeenCalled();
  });

  it("marks an image SELECTED once confirmed", async () => {
    await decideImage(actor, "img-1", { decision: "SELECT", confirmed: true });
    expect(AiGarmentGeneratedImageRepository.update).toHaveBeenCalledWith("img-1", { decision: "SELECTED" });
  });

  it("rejects an image without requiring confirmation", async () => {
    await decideImage(actor, "img-1", { decision: "REJECT" });
    expect(AiGarmentGeneratedImageRepository.update).toHaveBeenCalledWith("img-1", { decision: "REJECTED" });
  });
});

describe("updateImageNotes", () => {
  it("stores an empty string as null", async () => {
    (AiGarmentGeneratedImageRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "img-1",
      decision: "PENDING",
      project: { id: "proj-1", companyId: "co-1" },
    });
    await updateImageNotes(actor, "img-1", { userNotes: "" });
    expect(AiGarmentGeneratedImageRepository.update).toHaveBeenCalledWith("img-1", { userNotes: null });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  getAttachmentForDownload: vi.fn(),
}));
vi.mock("@/core/ai/image-generation/factory", () => ({ getImageGenerationProvider: vi.fn() }));
vi.mock("./visual-generation.repository", () => ({
  AiGarmentGeneratedImageRepository: { findWithProjectOwner: vi.fn() },
}));
vi.mock("./design-variation.repository", () => ({
  AiGarmentDesignVariationRunRepository: {
    create: vi.fn(),
    findActiveSince: vi.fn(),
    markSuccess: vi.fn(),
    markFailed: vi.fn(),
  },
  AiGarmentDesignVariationRepository: {
    create: vi.fn(),
    findByParentImageId: vi.fn(),
    countByParentImageId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    update: vi.fn(),
  },
}));

const { uploadAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { getImageGenerationProvider } = await import("@/core/ai/image-generation/factory");
const { ImageGenConfigMissingError } = await import("@/core/ai/image-generation/config");
const { ImageGenerationServiceError } = await import("@/core/ai/image-generation/types");
const { AiGarmentGeneratedImageRepository } = await import("./visual-generation.repository");
const { AiGarmentDesignVariationRunRepository, AiGarmentDesignVariationRepository } = await import("./design-variation.repository");
const { createDesignVariation, listDesignVariations, decideDesignVariation } = await import("./design-variation.service");

const actor = { companyId: "co-1", userId: "user-1" };

const parentImage = {
  id: "img-parent",
  projectId: "proj-1",
  designDirectionId: "dir-1",
  imageAttachmentId: "attachment-parent",
  decision: "PENDING",
  project: { id: "proj-1", companyId: "co-1" },
};

function mockProvider(overrides: { generateVariation?: ReturnType<typeof vi.fn> } = {}) {
  return { name: "openai", model: "gpt-image-1", generate: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentGeneratedImageRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(parentImage);
  (AiGarmentDesignVariationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentDesignVariationRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (getAttachmentForDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
    attachment: { mimeType: "image/png" },
    buffer: Buffer.from("parent-bytes"),
  });
  (uploadAttachment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "attachment-variation" });
  (AiGarmentDesignVariationRepository.countByParentImageId as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (AiGarmentDesignVariationRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "var-1", variationNumber: 1 });
});

const validInput = {
  featureKey: "SLEEVE" as const,
  currentFeatureValue: "Short raglan sleeve",
  newRequirement: "Change to a three-quarter length set-in sleeve",
  additionalInstructions: "",
};

describe("createDesignVariation", () => {
  it("rejects a parent image that doesn't belong to this company", async () => {
    (AiGarmentGeneratedImageRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...parentImage,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(createDesignVariation(actor, "img-parent", validInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a second modify-design call while one is already in progress for the same parent image", async () => {
    (AiGarmentDesignVariationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(createDesignVariation(actor, "img-parent", validInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("creates the run row even when the provider is unconfigured, and marks it FAILED with MISSING_CONFIG", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ImageGenConfigMissingError("OPENAI_API_KEY is missing.");
    });

    await expect(createDesignVariation(actor, "img-parent", validInput)).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentDesignVariationRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentDesignVariationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("logs a real FAILED run when the configured provider has no image-to-image capability", async () => {
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockProvider()); // no generateVariation

    await expect(createDesignVariation(actor, "img-parent", validInput)).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentDesignVariationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "UNSUPPORTED_OPERATION", expect.any(String));
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    const provider = mockProvider({ generateVariation: vi.fn().mockRejectedValue(new ImageGenerationServiceError("Timed out.", "TIMEOUT")) });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await expect(createDesignVariation(actor, "img-parent", validInput)).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentDesignVariationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("sends the parent image's real bytes and the hidden feature-change prompt to the provider, and records version control fields", async () => {
    const provider = mockProvider({
      generateVariation: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("v"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);
    (AiGarmentDesignVariationRepository.countByParentImageId as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await createDesignVariation(actor, "img-parent", validInput);

    expect(provider.generateVariation).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Short raglan sleeve"),
      count: 1,
      parentImage: { buffer: Buffer.from("parent-bytes"), mimeType: "image/png" },
    });
    const prompt = (provider.generateVariation as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Sleeve"); // the feature label, not the raw enum key
    expect(prompt).toContain("Change to a three-quarter length set-in sleeve");
    expect(prompt).not.toContain("Additional instructions"); // omitted when empty

    expect(uploadAttachment).toHaveBeenCalledWith(
      actor,
      "AI_GARMENT_PROJECT",
      "proj-1",
      expect.objectContaining({ mimeType: "image/png" }),
      "DESIGN_VARIATION_IMAGE"
    );
    expect(AiGarmentDesignVariationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentGeneratedImageId: "img-parent",
        variationRunId: "run-1",
        variationNumber: 3, // countByParentImageId (2) + 1
        featureKey: "SLEEVE",
        previousValue: "Short raglan sleeve",
        newValue: "Change to a three-quarter length set-in sleeve",
        imageAttachmentId: "attachment-variation",
      })
    );
    expect(AiGarmentDesignVariationRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
    expect(result).toEqual({ id: "var-1", variationNumber: 1 });
  });

  it("includes additional instructions in the prompt when supplied", async () => {
    const provider = mockProvider({
      generateVariation: vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("v"), mimeType: "image/png" }], model: "gpt-image-1", raw: {} }),
    });
    (getImageGenerationProvider as ReturnType<typeof vi.fn>).mockReturnValue(provider);

    await createDesignVariation(actor, "img-parent", { ...validInput, additionalInstructions: "Keep the cuff proportion identical." });

    const prompt = (provider.generateVariation as ReturnType<typeof vi.fn>).mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Additional instructions from the user:");
    expect(prompt).toContain("Keep the cuff proportion identical.");
  });
});

describe("listDesignVariations", () => {
  it("rejects a parent image that doesn't belong to this company", async () => {
    (AiGarmentGeneratedImageRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...parentImage,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(listDesignVariations("co-1", "img-parent")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns every variation for the parent image, ordered by variation number", async () => {
    (AiGarmentDesignVariationRepository.findByParentImageId as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "var-1" }, { id: "var-2" }]);
    const result = await listDesignVariations("co-1", "img-parent");
    expect(AiGarmentDesignVariationRepository.findByParentImageId).toHaveBeenCalledWith("img-parent");
    expect(result).toEqual([{ id: "var-1" }, { id: "var-2" }]);
  });
});

describe("decideDesignVariation", () => {
  const pendingVariation = { id: "var-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentDesignVariationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingVariation);
    (AiGarmentDesignVariationRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "var-1", decision: "SELECTED" });
  });

  it("rejects a variation that doesn't belong to this company", async () => {
    (AiGarmentDesignVariationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingVariation,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(decideDesignVariation(actor, "var-1", { decision: "SELECT", confirmed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires explicit confirmation to SELECT a variation", async () => {
    await expect(decideDesignVariation(actor, "var-1", { decision: "SELECT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiGarmentDesignVariationRepository.update).not.toHaveBeenCalled();
  });

  it("marks a variation SELECTED once confirmed", async () => {
    await decideDesignVariation(actor, "var-1", { decision: "SELECT", confirmed: true });
    expect(AiGarmentDesignVariationRepository.update).toHaveBeenCalledWith("var-1", { decision: "SELECTED" });
  });

  it("keeps the original without requiring confirmation", async () => {
    await decideDesignVariation(actor, "var-1", { decision: "KEEP_ORIGINAL" });
    expect(AiGarmentDesignVariationRepository.update).toHaveBeenCalledWith("var-1", { decision: "KEPT_ORIGINAL" });
  });
});

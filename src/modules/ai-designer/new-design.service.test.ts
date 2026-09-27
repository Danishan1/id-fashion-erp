import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { rankGarmentTemplates, GARMENT_TEMPLATES } from "@/core/ai-designer/catalogs/garment-template-catalog";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(), assert: vi.fn() } }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ previewNextMasterCode: vi.fn() }));
vi.mock("@/core/attachments/AttachmentService", () => ({ uploadAttachment: vi.fn(), getAttachmentForDownload: vi.fn() }));
vi.mock("@/core/ai-designer/garment-analysis/analyze", () => ({ analyzeGarment: vi.fn(), PROMPT_VERSION: "v1" }));
vi.mock("@/core/ai/provider-manager/AIProviderManager", () => ({ runWithFailover: vi.fn(), hasProviderForCapability: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialByName: vi.fn(), findMaterialById: vi.fn(), findManyMaterials: vi.fn() },
}));
vi.mock("@/modules/products/product.service", () => ({ createMaterial: vi.fn(), setProductMainImage: vi.fn() }));
vi.mock("./ai-designer.service", () => ({
  bumpVersion: vi.fn(),
  createProject: vi.fn(),
  generateDesign: vi.fn(),
  getProjectById: vi.fn(),
  runFabricAnalysis: vi.fn(),
  selectExistingFabric: vi.fn(),
  uploadFabricImage: vi.fn(),
}));
vi.mock("./ai-designer.repository", () => ({
  AiDesignerProjectRepository: { findAnyById: vi.fn(), update: vi.fn() },
  AiDesignerPromptRepository: { create: vi.fn(), markSuccess: vi.fn(), markSuccessWithProvider: vi.fn(), markFailed: vi.fn(), findActiveSince: vi.fn() },
  AiDesignerGenerationRepository: { create: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn(), findManyByProjectAndPromptType: vi.fn() },
  AiDesignerImageRepository: { createMany: vi.fn(), findByGenerationId: vi.fn(), findById: vi.fn(), update: vi.fn() },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { previewNextMasterCode } = await import("@/core/numbering/DocumentNumberingService");
const { uploadAttachment, getAttachmentForDownload } = await import("@/core/attachments/AttachmentService");
const { runWithFailover, hasProviderForCapability } = await import("@/core/ai/provider-manager/AIProviderManager");
const { readFile } = await import("node:fs/promises");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { createMaterial, setProductMainImage } = await import("@/modules/products/product.service");
const designer = await import("./ai-designer.service");
const repos = await import("./ai-designer.repository");
const svc = await import("./new-design.service");

const actor = { companyId: "co-1", userId: "user-1" };

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    companyId: "co-1",
    projectNumber: "AID-2026-00099",
    designSource: "FABRIC",
    fabricProductId: null,
    fabricImageAttachmentId: "att-fabric",
    fabricName: "Lilac Swiss Dot Georgette",
    fabricComposition: "Polyester",
    fabricGsm: "Lightweight",
    fabricWidth: null,
    fabricWeave: "Plain",
    fabricPatternType: "Dobby dot",
    garmentTemplateKey: "women-dress",
    customTemplateAttachmentId: null,
    productCategory: "Dress",
    targetCustomer: "WOMEN",
    ageGroup: "25-40",
    environmentKey: "STUDIO_WHITE",
    environmentLabel: "Studio White",
    isCustomEnvironment: false,
    sourceAnalysisJson: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repos.AiDesignerPromptRepository.findActiveSince).mockResolvedValue(null as never);
  vi.mocked(repos.AiDesignerPromptRepository.create).mockResolvedValue({ id: "prompt-1" } as never);
  vi.mocked(repos.AiDesignerGenerationRepository.create).mockResolvedValue({ id: "gen-1" } as never);
  vi.mocked(getAttachmentForDownload).mockResolvedValue({
    attachment: { mimeType: "image/png", fileName: "fabric.png" },
    buffer: Buffer.from("fabric"),
  } as never);
  vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);
  vi.mocked(hasProviderForCapability).mockImplementation(async (_c, cap) => cap === "DESIGN_REPLICATION");
});

describe("garment template ranking", () => {
  it("puts the closest analysed garment type first and prefers photo-backed templates", () => {
    const ranked = rankGarmentTemplates({ primary: "Tiered midi dress", secondary: "Top, Kurti" });
    expect(ranked[0].key).toBe("women-dress");
    expect(ranked.map((r) => r.key)).toContain("women-top");
  });

  it("recognises a lehenga and falls back to photo templates when nothing matches", () => {
    expect(rankGarmentTemplates({ primary: "Bridal lehenga choli" })[0].key).toBe("women-lehenga");
    const fallback = rankGarmentTemplates({ primary: "zzz" });
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.every((s) => GARMENT_TEMPLATES.find((t) => t.key === s.key)?.templateUrl)).toBe(true);
  });
});

describe("fabric suggestion scoring", () => {
  it("scores by keyword overlap", () => {
    expect(svc.scoreFabricMatch("Georgette Swiss Dot lilac", ["georgette", "lilac"])).toBe(2);
    expect(svc.scoreFabricMatch("Cotton Cambric", ["georgette"])).toBe(0);
  });
});

describe("autoCreateFabricMaster", () => {
  it("creates a FABRIC material with the photo as main image and links it", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(PermissionService.can).mockResolvedValue(true);
    vi.mocked(ProductRepository.findMaterialByName).mockResolvedValue(null as never);
    vi.mocked(previewNextMasterCode).mockResolvedValue("MAT-00042");
    vi.mocked(createMaterial).mockResolvedValue({ id: "mat-1" } as never);

    const result = await svc.autoCreateFabricMaster(actor, "proj-1");

    expect(result).toEqual({ productId: "mat-1", created: true });
    expect(createMaterial).toHaveBeenCalledWith(actor, expect.objectContaining({ styleCode: "MAT-00042", materialCategory: "FABRIC" }));
    expect(uploadAttachment).toHaveBeenCalledWith(actor, "PRODUCT", "mat-1", expect.anything(), "FABRIC_IMAGE");
    expect(setProductMainImage).toHaveBeenCalledWith(actor, "mat-1", "att-new");
    expect(designer.selectExistingFabric).toHaveBeenCalledWith(actor, "proj-1", { fabricProductId: "mat-1" });
  });

  it("links to an existing same-named fabric instead of duplicating it", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(PermissionService.can).mockResolvedValue(true);
    vi.mocked(ProductRepository.findMaterialByName).mockResolvedValue({ id: "mat-existing" } as never);

    const result = await svc.autoCreateFabricMaster(actor, "proj-1");

    expect(result).toEqual({ productId: "mat-existing", created: false });
    expect(createMaterial).not.toHaveBeenCalled();
  });

  it("skips silently when the user may not create masters", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(PermissionService.can).mockResolvedValue(false);

    expect(await svc.autoCreateFabricMaster(actor, "proj-1")).toEqual({ productId: null, created: false });
    expect(createMaterial).not.toHaveBeenCalled();
  });
});

describe("selectGarmentTemplate", () => {
  it("sets customer/age/category from the template and rejects unknown keys", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    await svc.selectGarmentTemplate(actor, "proj-1", "women-lehenga");
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ garmentTemplateKey: "women-lehenga", productCategory: "Lehenga", targetCustomer: "WOMEN" })
    );
    await expect(svc.selectGarmentTemplate(actor, "proj-1", "nope")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("refuses to run on a classic-wizard project", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project({ designSource: null }) as never);
    await expect(svc.selectGarmentTemplate(actor, "proj-1", "women-dress")).rejects.toThrow(/classic wizard/);
  });

  it("is company-scoped", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(null as never);
    await expect(svc.selectGarmentTemplate({ companyId: "other", userId: "u" }, "proj-1", "women-dress")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repos.AiDesignerProjectRepository.findAnyById).toHaveBeenCalledWith("other", "proj-1");
  });
});

describe("generateNewDesign", () => {
  it("dress-swaps onto the template photo via replicateWithNewMaterial", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("template") as never);
    const replicate = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("out"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "openai", replicateWithNewMaterial: replicate })) as { images: unknown[] };
      return { ...out, providerName: "openai", model: "gpt-image-1" };
    }) as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }] as never);

    await svc.generateNewDesign(actor, "proj-1", { imageCount: 1 });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "DESIGN_REPLICATION" }));
    const args = replicate.mock.calls[0][0];
    expect(args.referenceImage.buffer.toString()).toBe("template");
    expect(args.materialImage.buffer.toString()).toBe("fabric");
    expect(args.prompt).toContain("same model");
    expect(designer.bumpVersion).toHaveBeenCalledWith(actor, "proj-1", "img-1", expect.any(String), expect.any(Object));
    expect(designer.generateDesign).not.toHaveBeenCalled();
  });

  it("falls back to the classic generation when the garment type has no photo", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      project({ garmentTemplateKey: "women-skirt", productCategory: "Skirt" }) as never
    );
    vi.mocked(designer.generateDesign).mockResolvedValue({ generation: {}, images: [] } as never);

    await svc.generateNewDesign(actor, "proj-1", { imageCount: 3 });

    expect(designer.generateDesign).toHaveBeenCalledWith(actor, "proj-1", { imageCount: 3, viewAngle: "FRONT" });
    expect(runWithFailover).not.toHaveBeenCalled();
  });

  it("uses Multi-Fabric (applyFabric) when no provider has Design Replication", async () => {
    vi.mocked(hasProviderForCapability).mockImplementation(async (_c, cap) => cap === "MULTI_FABRIC");
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("template") as never);
    const applyFabric = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("out"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "openai", applyFabric })) as { images: unknown[] };
      return { ...out, providerName: "openai", model: "gpt-image-1" };
    }) as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1" }] as never);

    const result = await svc.generateNewDesign(actor, "proj-1", { imageCount: 1 });

    expect(runWithFailover).toHaveBeenCalledWith(expect.objectContaining({ capability: "MULTI_FABRIC" }));
    expect(applyFabric.mock.calls[0][0].baseImage.buffer.toString()).toBe("template");
    expect(result.usedTemplate).toBe(true);
  });

  it("falls back to classic generation when no two-image capability is enabled", async () => {
    vi.mocked(hasProviderForCapability).mockResolvedValue(false);
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("template") as never);
    vi.mocked(designer.generateDesign).mockResolvedValue({ generation: {}, images: [] } as never);

    const result = await svc.generateNewDesign(actor, "proj-1", { imageCount: 3 });

    expect(designer.generateDesign).toHaveBeenCalled();
    expect(runWithFailover).not.toHaveBeenCalled();
    expect(result.usedTemplate).toBe(false);
  });

  it("reports a clear error when no fabric photo exists", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project({ fabricImageAttachmentId: null }) as never);
    await expect(svc.generateNewDesign(actor, "proj-1", { imageCount: 1 })).rejects.toThrow(/fabric photo/);
  });

  it("marks the run failed when the provider cannot dress-swap", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("template") as never);
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) =>
      params.call({ name: "cloudflare" })) as never);

    await expect(svc.generateNewDesign(actor, "proj-1", { imageCount: 1 })).rejects.toThrow(/cannot dress a model photo/);
    expect(repos.AiDesignerGenerationRepository.markFailed).toHaveBeenCalledWith("gen-1");
  });
});

describe("generateColorVariants", () => {
  it("creates one COLOR_VARIANT generation per colour on the current image", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(designer.getProjectById).mockResolvedValue({
      currentVersion: { currentImage: { id: "img-1", imageAttachmentId: "att-img" } },
    } as never);
    const variation = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("v"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "openai", generateVariation: variation })) as { images: unknown[] };
      return { ...out, providerName: "openai", model: "m" };
    }) as never);
    vi.mocked(repos.AiDesignerGenerationRepository.findManyByProjectAndPromptType).mockResolvedValue([] as never);

    const result = await svc.generateColorVariants(actor, "proj-1", { colors: ["Black", "Maroon", "Black"] });

    expect(variation).toHaveBeenCalledTimes(2);
    expect(variation.mock.calls[0][0].prompt).toContain("Black");
    expect(repos.AiDesignerGenerationRepository.create).toHaveBeenCalledWith(expect.objectContaining({ editedFeature: "Maroon", parentImageId: "img-1" }));
    expect(repos.AiDesignerPromptRepository.create).toHaveBeenCalledWith(expect.objectContaining({ promptType: "COLOR_VARIANT" }));
    expect(result.results.every((r) => r.ok)).toBe(true);
  });

  it("requires a generated design first", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(designer.getProjectById).mockResolvedValue({ currentVersion: null } as never);
    await expect(svc.generateColorVariants(actor, "proj-1", { colors: ["Black"] })).rejects.toThrow(/Generate a design first/);
  });
});

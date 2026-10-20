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
  applyEditVariation: vi.fn(),
  bumpVersion: vi.fn(),
  createProject: vi.fn(),
  generateDesign: vi.fn(),
  getProjectById: vi.fn(),
  runFabricAnalysis: vi.fn(),
  selectExistingFabric: vi.fn(),
  uploadFabricImage: vi.fn(),
}));
vi.mock("./ai-designer.repository", () => ({
  AiDesignerProjectRepository: { findAnyById: vi.fn(), update: vi.fn(), findByIdWithDetails: vi.fn() },
  AiDesignerPromptRepository: { create: vi.fn(), markSuccess: vi.fn(), markSuccessWithProvider: vi.fn(), markFailed: vi.fn(), findActiveSince: vi.fn() },
  AiDesignerGenerationRepository: { create: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn(), findManyByProjectAndPromptType: vi.fn() },
  AiDesignerImageRepository: {
    createMany: vi.fn(),
    findByGenerationId: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    findSketchFor: vi.fn(),
    findWithProjectOwner: vi.fn(),
    unlinkSketchFor: vi.fn(),
    findByProjectAndAttachment: vi.fn(),
  },
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
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "img-1", imageAttachmentId: "att-new" }] as never);

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

describe("generateNewDesign — every garment gets its own linked sketch", () => {
  function mockProviders(opts: { failSketchFor?: string } = {}) {
    let uploadCount = 0;
    vi.mocked(uploadAttachment).mockImplementation((async () => ({ id: `att-${++uploadCount}` })) as never);
    // Rows mirror whatever was "uploaded" so persistImages can map attachments back to rows.
    const rows: { id: string; imageAttachmentId: string }[] = [];
    vi.mocked(repos.AiDesignerImageRepository.createMany).mockImplementation((async (data: { imageAttachmentId: string }[]) => {
      for (const d of data) rows.push({ id: `img-${d.imageAttachmentId}`, imageAttachmentId: d.imageAttachmentId });
      return { count: data.length };
    }) as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockImplementation((async () => [...rows]) as never);

    const replicate = vi.fn().mockResolvedValue({
      images: [
        { buffer: Buffer.from("garment-A"), mimeType: "image/png" },
        { buffer: Buffer.from("garment-B"), mimeType: "image/png" },
      ],
    });
    const generateTechnicalFlat = vi.fn(async (args: { baseImage: { buffer: Buffer } }) => {
      if (opts.failSketchFor && args.baseImage.buffer.toString() === opts.failSketchFor) throw new Error("credits exhausted");
      return { images: [{ buffer: Buffer.from(`sketch-of-${args.baseImage.buffer.toString()}`), mimeType: "image/png" }] };
    });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "openai", replicateWithNewMaterial: replicate, generateTechnicalFlat })) as { images: unknown[] };
      return { ...out, providerName: "openai", model: "gpt-image-1" };
    }) as never);
    return { replicate, generateTechnicalFlat, rows };
  }

  it("draws one sketch per garment from that garment's own photo and links it", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("template") as never);
    const { generateTechnicalFlat } = mockProviders();

    const result = await svc.generateNewDesign(actor, "proj-1", { imageCount: 3 });

    expect(generateTechnicalFlat).toHaveBeenCalledTimes(2);
    expect(generateTechnicalFlat.mock.calls.map((c) => c[0].baseImage.buffer.toString()).sort()).toEqual(["garment-A", "garment-B"]);
    expect(result.images).toHaveLength(2);
    expect(result.sketches).toHaveLength(2);
    expect(result.sketchFailures).toBe(0);

    const created = vi.mocked(repos.AiDesignerImageRepository.createMany).mock.calls.flatMap((c) => c[0]);
    const garments = created.filter((r) => r.kind === "GARMENT");
    const sketches = created.filter((r) => r.kind === "SKETCH");
    expect(garments).toHaveLength(2);
    expect(sketches).toHaveLength(2);
    // Each sketch points at a different garment row.
    expect(new Set(sketches.map((s) => s.sketchForImageId))).toEqual(new Set(garments.map((g) => `img-${g.imageAttachmentId}`)));
  });

  it("keeps the designs when one sketch fails, and reports it", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("template") as never);
    mockProviders({ failSketchFor: "garment-B" });

    const result = await svc.generateNewDesign(actor, "proj-1", { imageCount: 3 });

    expect(result.images).toHaveLength(2);
    expect(result.sketches).toHaveLength(1);
    expect(result.sketchFailures).toBe(1);
    expect(result.sketchError).toMatch(/credits exhausted/);
    expect(repos.AiDesignerGenerationRepository.markFailed).not.toHaveBeenCalled();
  });

  it("also sketches every garment on the classic (no template) path", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(
      project({ garmentTemplateKey: "women-skirt", productCategory: "Skirt" }) as never
    );
    vi.mocked(designer.generateDesign).mockResolvedValue({
      generation: { id: "gen-classic" },
      images: [
        { id: "g-1", imageAttachmentId: "att-g1" },
        { id: "g-2", imageAttachmentId: "att-g2" },
      ],
    } as never);
    const { generateTechnicalFlat } = mockProviders();

    const result = await svc.generateNewDesign(actor, "proj-1", { imageCount: 3 });

    expect(generateTechnicalFlat).toHaveBeenCalledTimes(2);
    expect(result.sketches).toHaveLength(2);
    const sketchRows = vi.mocked(repos.AiDesignerImageRepository.createMany).mock.calls.flatMap((c) => c[0]);
    expect(sketchRows.map((r) => r.sketchForImageId).sort()).toEqual(["g-1", "g-2"]);
    expect(sketchRows.every((r) => r.kind === "SKETCH" && r.generationId === "gen-classic")).toBe(true);
  });
});

describe("garment / sketch pairing", () => {
  it("lists only garments, each with its own sketch", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project() as never);
    vi.mocked(repos.AiDesignerGenerationRepository.findManyByProjectAndPromptType).mockResolvedValue([
      {
        images: [
          { id: "g-1", kind: "GARMENT", decision: "PENDING", imageAttachmentId: "att-g1", sketch: { id: "s-1", imageAttachmentId: "att-s1", decision: "PENDING" } },
          { id: "s-1", kind: "SKETCH", decision: "PENDING", imageAttachmentId: "att-s1", sketch: null },
          { id: "g-2", kind: "GARMENT", decision: "PENDING", imageAttachmentId: "att-g2", sketch: { id: "s-old", imageAttachmentId: "att-old", decision: "REJECTED" } },
          { id: "g-3", kind: "GARMENT", decision: "REJECTED", imageAttachmentId: "att-g3", sketch: null },
        ],
      },
    ] as never);

    const list = await svc.listGeneratedDesigns(actor, "proj-1");

    expect(list.map((i) => i.id)).toEqual(["g-1", "g-2"]);
    expect(list[0].sketch).toEqual({ id: "s-1", imageAttachmentId: "att-s1" });
    expect(list[1].sketch).toBeNull();
  });

  it("making a garment current points the working sketch at that garment's own sketch", async () => {
    vi.mocked(designer.getProjectById).mockResolvedValue({ currentVersionId: "v-1", currentVersion: { currentImageId: "g-1" } } as never);
    vi.mocked(repos.AiDesignerImageRepository.findById).mockResolvedValue({ id: "g-2", projectId: "proj-1", kind: "GARMENT", decision: "PENDING" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findSketchFor).mockResolvedValue({ id: "s-2", imageAttachmentId: "att-s2" } as never);

    await svc.makeImageCurrent(actor, "proj-1", "g-2");

    expect(designer.bumpVersion).toHaveBeenCalledWith(actor, "proj-1", "g-2", expect.any(String), expect.any(Object));
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: "att-s2" });
  });

  it("clears the working sketch when the chosen garment has none, and refuses a sketch image", async () => {
    vi.mocked(designer.getProjectById).mockResolvedValue({ currentVersionId: "v-1", currentVersion: { currentImageId: "g-1" } } as never);
    vi.mocked(repos.AiDesignerImageRepository.findById).mockResolvedValueOnce({ id: "g-2", projectId: "proj-1", kind: "GARMENT", decision: "SELECTED" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findSketchFor).mockResolvedValue(null as never);

    await svc.makeImageCurrent(actor, "proj-1", "g-2");
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: null });

    vi.mocked(repos.AiDesignerImageRepository.findById).mockResolvedValueOnce({ id: "s-1", projectId: "proj-1", kind: "SKETCH" } as never);
    await expect(svc.makeImageCurrent(actor, "proj-1", "s-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("generateSketchForImage unlinks the garment's old sketch and links the new one", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...project(),
      currentVersionId: "v-1",
      currentVersion: { currentImageId: "g-1" },
    } as never);
    vi.mocked(repos.AiDesignerImageRepository.findById).mockResolvedValue({ id: "g-2", projectId: "proj-1", kind: "GARMENT", imageAttachmentId: "att-g2" } as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new-sketch" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "s-new", imageAttachmentId: "att-new-sketch" }] as never);
    const generateTechnicalFlat = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("sk"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "gemini", generateTechnicalFlat })) as { images: unknown[] };
      return { ...out, providerName: "gemini", model: "m" };
    }) as never);

    const result = await svc.generateSketchForImage(actor, "proj-1", "g-2");

    expect(repos.AiDesignerImageRepository.unlinkSketchFor).toHaveBeenCalledWith("g-2");
    expect(repos.AiDesignerImageRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "SKETCH", sketchForImageId: "g-2", imageAttachmentId: "att-new-sketch" }),
    ]);
    expect(result.sketchAttachmentId).toBe("att-new-sketch");
    // g-2 is not the current design, so the working sketch is left alone.
    expect(repos.AiDesignerProjectRepository.update).not.toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: "att-new-sketch" });
  });

  it("generateSketchForImage refuses a sketch image", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(project() as never);
    vi.mocked(repos.AiDesignerImageRepository.findById).mockResolvedValue({ id: "s-1", projectId: "proj-1", kind: "SKETCH" } as never);
    await expect(svc.generateSketchForImage(actor, "proj-1", "s-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("setCurrentSketch restores an earlier sketch of the same project only", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findAnyById).mockResolvedValue(project({ sketchImageAttachmentId: "att-now" }) as never);
    vi.mocked(repos.AiDesignerImageRepository.findByProjectAndAttachment).mockResolvedValueOnce({ id: "s-1", kind: "SKETCH" } as never);

    await svc.setCurrentSketch(actor, "proj-1", "att-earlier");
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: "att-earlier" });

    vi.mocked(repos.AiDesignerImageRepository.findByProjectAndAttachment).mockResolvedValueOnce(null as never);
    await expect(svc.setCurrentSketch(actor, "proj-1", "att-other")).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(repos.AiDesignerImageRepository.findByProjectAndAttachment).mockResolvedValueOnce({ id: "g-1", kind: "GARMENT" } as never);
    await expect(svc.setCurrentSketch(actor, "proj-1", "att-garment")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("generateSketchForProject", () => {
  it("generates a CAD flat sketch from current garment image and sets sketchImageAttachmentId", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...project(),
      currentVersion: { currentImageId: "img-garment", currentImage: { id: "img-garment", kind: "GARMENT", imageAttachmentId: "att-garment" } },
      currentVersionId: "v-1",
    } as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-sketch-flat" } as never);
    const generateVariation = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("sketch-buf"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "gemini", generateVariation })) as { images: unknown[] };
      return { ...out, providerName: "gemini", model: "imagen-3" };
    }) as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([
      { id: "img-sketch-new", imageAttachmentId: "att-sketch-flat" },
    ] as never);

    const result = await svc.generateSketchForProject(actor, "proj-1", { viewAngle: "BOTH", notes: "French darts and puff sleeves" });

    expect(result.sketchAttachmentId).toBe("att-sketch-flat");
    expect(repos.AiDesignerImageRepository.unlinkSketchFor).toHaveBeenCalledWith("img-garment");
    expect(repos.AiDesignerImageRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "SKETCH", sketchForImageId: "img-garment" }),
    ]);
    expect(repos.AiDesignerPromptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ promptType: "IMAGE_GENERATE", promptText: expect.stringContaining("technical flat sketch") })
    );
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ sketchImageAttachmentId: "att-sketch-flat" })
    );
  });
});

describe("executeSketchEdit", () => {
  it("edits the technical sketch and optionally re-renders garment in project fabric", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...project(),
      sketchImageAttachmentId: "att-existing-sketch",
      currentVersion: { currentImage: { id: "img-garment", imageAttachmentId: "att-garment" }, currentImageId: "img-garment" },
    } as never);

    const generateVariation = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("revised-sketch"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "gemini", generateVariation })) as { images: unknown[] };
      return { ...out, providerName: "gemini", model: "imagen-3" };
    }) as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-revised-sketch" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([
      { id: "img-revised-sketch", imageAttachmentId: "att-revised-sketch" },
    ] as never);

    const result = await svc.executeSketchEdit(actor, "proj-1", {
      instruction: "Convert round neckline into mandarin collar and add front placket",
      structuralFields: { neckline: "Mandarin Collar", closure: "Front Placket" },
      viewAngle: "FRONT",
      imageCount: 1,
      generateGarment: false,
    });

    expect(result.images.length).toBeGreaterThan(0);
    expect(repos.AiDesignerPromptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: "IMAGE_EDIT",
        promptText: expect.stringContaining("Mandarin Collar"),
      })
    );
    expect(repos.AiDesignerGenerationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ editedFeature: "Through Sketch Edit" })
    );
  });

  it("draw with pen: sends the pen-marked sketch as the reference with the markup prompt", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...project(),
      sketchImageAttachmentId: "att-existing-sketch",
      currentVersion: { currentImage: { id: "img-garment", imageAttachmentId: "att-garment" }, currentImageId: "img-garment" },
    } as never);
    vi.mocked(uploadAttachment).mockResolvedValueOnce({ id: "att-markup" } as never).mockResolvedValueOnce({ id: "att-clean" } as never);
    vi.mocked(getAttachmentForDownload).mockClear();
    const generateVariation = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("clean-sketch"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "gemini", generateVariation })) as { images: unknown[] };
      return { ...out, providerName: "gemini", model: "imagen-3" };
    }) as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([
      { id: "img-clean", imageAttachmentId: "att-clean" },
    ] as never);
    const markup = { buffer: Buffer.from("sketch-with-red-lines"), mimeType: "image/png" };

    await svc.executeSketchEdit(
      actor,
      "proj-1",
      { instruction: "", viewAngle: "FRONT", imageCount: 1, generateGarment: false },
      { markupImage: markup }
    );

    expect(generateVariation).toHaveBeenCalledWith(expect.objectContaining({ parentImage: markup }));
    expect(generateVariation.mock.calls[0][0].prompt).toContain("PEN MARKUP KEY");
    expect(getAttachmentForDownload).not.toHaveBeenCalledWith(actor.companyId, "att-existing-sketch");
    expect(uploadAttachment).toHaveBeenCalledWith(actor, "AI_DESIGNER_PROJECT", "proj-1", expect.anything(), "SKETCH_PEN_MARKUP");
    expect(repos.AiDesignerGenerationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ editedFeature: "Sketch Pen Markup" })
    );
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: "att-clean" });
  });

  it("rejects an edit with no pen markup, options or instruction", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(project() as never);
    await expect(
      svc.executeSketchEdit(actor, "proj-1", { instruction: "  ", viewAngle: "FRONT", imageCount: 1 })
    ).rejects.toThrow(/Draw your changes/);
  });
});

describe("applying an edit keeps garment and sketch in step", () => {
  function mockRender() {
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-rendered" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findByGenerationId).mockResolvedValue([{ id: "g-rendered", imageAttachmentId: "att-rendered" }] as never);
    const replicate = vi.fn().mockResolvedValue({ images: [{ buffer: Buffer.from("garment"), mimeType: "image/png" }] });
    vi.mocked(runWithFailover).mockImplementation((async (params: { call: (p: unknown) => unknown }) => {
      const out = (await params.call({ name: "gemini", replicateWithNewMaterial: replicate })) as { images: unknown[] };
      return { ...out, providerName: "gemini", model: "m" };
    }) as never);
    return replicate;
  }

  it("garment preview: applies it and gives the new garment its own sketch", async () => {
    vi.mocked(repos.AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "g-new", kind: "GARMENT", decision: "PENDING", projectId: "proj-1", project: { companyId: "co-1" },
    } as never);
    vi.mocked(designer.applyEditVariation).mockResolvedValue({ id: "v-2" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findSketchFor).mockResolvedValue({ id: "s-new", imageAttachmentId: "att-s-new" } as never);

    const result = await svc.applyEditWithPairedSketch(actor, "g-new", { confirmed: true });

    expect(designer.applyEditVariation).toHaveBeenCalledWith(actor, "g-new", { confirmed: true });
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: "att-s-new" });
    expect(result).toMatchObject({ id: "v-2", sketchError: null });
  });

  it("garment preview: reports (not fails) when its sketch can't be generated, and clears the stale sketch", async () => {
    vi.mocked(repos.AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "g-new", kind: "GARMENT", decision: "PENDING", projectId: "proj-1", project: { companyId: "co-1" },
    } as never);
    vi.mocked(designer.applyEditVariation).mockResolvedValue({ id: "v-2" } as never);
    vi.mocked(repos.AiDesignerImageRepository.findSketchFor).mockResolvedValue(null as never);
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({ ...project(), currentVersion: { currentImageId: "g-new" } } as never);
    vi.mocked(repos.AiDesignerImageRepository.findById).mockResolvedValue({ id: "g-new", projectId: "proj-1", kind: "GARMENT", imageAttachmentId: "att-g" } as never);
    vi.mocked(runWithFailover).mockRejectedValue(new Error("credits exhausted"));

    const result = await svc.applyEditWithPairedSketch(actor, "g-new", { confirmed: true });

    expect(result.sketchError).toMatch(/credits exhausted/);
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: null });
  });

  it("sketch preview with a rendered garment: the garment becomes the design, the sketch the working sketch", async () => {
    vi.mocked(repos.AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "s-1", kind: "SKETCH", decision: "PENDING", sketchForImageId: "g-1", imageAttachmentId: "att-s1", projectId: "proj-1", generationId: "gen-e", project: { companyId: "co-1" },
    } as never);
    vi.mocked(designer.applyEditVariation).mockResolvedValue({ id: "v-3" } as never);

    await svc.applyEditWithPairedSketch(actor, "s-1", { confirmed: true });

    expect(designer.applyEditVariation).toHaveBeenCalledWith(actor, "g-1", { confirmed: true });
    expect(repos.AiDesignerImageRepository.update).toHaveBeenCalledWith("s-1", { decision: "SELECTED" });
    expect(repos.AiDesignerProjectRepository.update).toHaveBeenCalledWith("proj-1", { sketchImageAttachmentId: "att-s1" });
    expect(runWithFailover).not.toHaveBeenCalled();
  });

  it("sketch preview with no garment: renders the garment from the sketch first, then applies it", async () => {
    vi.mocked(repos.AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({
      id: "s-2", kind: "SKETCH", decision: "PENDING", sketchForImageId: null, imageAttachmentId: "att-s2", projectId: "proj-1", generationId: "gen-e", project: { companyId: "co-1" },
    } as never);
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue(project() as never);
    vi.mocked(designer.applyEditVariation).mockResolvedValue({ id: "v-4" } as never);
    const replicate = mockRender();

    await svc.applyEditWithPairedSketch(actor, "s-2", { confirmed: true });

    expect(replicate).toHaveBeenCalledTimes(1);
    expect(repos.AiDesignerImageRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "GARMENT", generationId: "gen-e", imageAttachmentId: "att-rendered" }),
    ]);
    expect(repos.AiDesignerImageRepository.update).toHaveBeenCalledWith("s-2", { sketchForImageId: "g-rendered" });
    expect(designer.applyEditVariation).toHaveBeenCalledWith(actor, "g-rendered", { confirmed: true });
  });

  it("refuses an apply without confirmation, or a preview from another company", async () => {
    await expect(svc.applyEditWithPairedSketch(actor, "x", { confirmed: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    vi.mocked(repos.AiDesignerImageRepository.findWithProjectOwner).mockResolvedValue({ id: "x", kind: "GARMENT", project: { companyId: "other" } } as never);
    await expect(svc.applyEditWithPairedSketch(actor, "x", { confirmed: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("applyWorkingSketchToGarment renders the garment from the edited sketch as a new version", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...project(),
      sketchImageAttachmentId: "att-edited",
      currentVersion: { currentImage: { id: "g-old" }, designSnapshotJson: {} },
    } as never);
    vi.mocked(repos.AiDesignerImageRepository.findByProjectAndAttachment).mockResolvedValue({ id: "s-edited", kind: "SKETCH", sketchForImageId: null } as never);
    mockRender();
    vi.mocked(designer.bumpVersion).mockResolvedValue({ id: "v-new", versionNumber: 5 } as never);

    await svc.applyWorkingSketchToGarment(actor, "proj-1");

    expect(repos.AiDesignerImageRepository.update).toHaveBeenCalledWith("s-edited", { sketchForImageId: "g-rendered" });
    expect(designer.bumpVersion).toHaveBeenCalledWith(actor, "proj-1", "g-rendered", expect.any(String), {}, expect.objectContaining({ approvalStatus: "AI_MODIFIED" }));
  });

  it("applyWorkingSketchToGarment refuses when the garment already matches the sketch", async () => {
    vi.mocked(repos.AiDesignerProjectRepository.findByIdWithDetails).mockResolvedValue({
      ...project(),
      sketchImageAttachmentId: "att-s",
      currentVersion: { currentImage: { id: "g-1" } },
    } as never);
    vi.mocked(repos.AiDesignerImageRepository.findByProjectAndAttachment).mockResolvedValue({ id: "s", kind: "SKETCH", sketchForImageId: "g-1" } as never);
    await expect(svc.applyWorkingSketchToGarment(actor, "proj-1")).rejects.toThrow(/already matches/);
  });
});

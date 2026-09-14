import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/logging/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));
vi.mock("./ai-designer.repository", () => ({
  AiDesignerProductDesignAttributeRepository: {
    findMany: vi.fn(),
    findActiveByCategory: vi.fn(),
    findAnyById: vi.fn(),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  AiDesignerOptionReferenceImageRepository: {
    findMany: vi.fn(),
    findByValue: vi.fn(),
    upsert: vi.fn(),
    deleteByValue: vi.fn(),
  },
}));

const { AiDesignerProductDesignAttributeRepository, AiDesignerOptionReferenceImageRepository } = await import("./ai-designer.repository");
const { uploadAttachment, deleteAttachment } = await import("@/core/attachments/AttachmentService");
const {
  createProductDesignAttribute,
  updateProductDesignAttribute,
  getEffectiveDesignAttributesForCategory,
  listAllKnownOptionValues,
  listOptionReferenceImages,
  uploadOptionReferenceImage,
  deleteOptionReferenceImage,
} = await import("./ai-designer-attribute-master.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(AiDesignerProductDesignAttributeRepository.findMany).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.findActiveByCategory).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.findAnyById).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.findByKey).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.create).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.update).mockReset();
  vi.mocked(AiDesignerOptionReferenceImageRepository.findMany).mockReset();
  vi.mocked(AiDesignerOptionReferenceImageRepository.findByValue).mockReset();
  vi.mocked(AiDesignerOptionReferenceImageRepository.upsert).mockReset();
  vi.mocked(AiDesignerOptionReferenceImageRepository.deleteByValue).mockReset();
  vi.mocked(uploadAttachment).mockReset();
  vi.mocked(deleteAttachment).mockReset();
});

describe("getEffectiveDesignAttributesForCategory", () => {
  it("returns the company's own real rows when any exist for the category", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findActiveByCategory).mockResolvedValue([
      { id: "a1", attributeKey: "neckline", attributeLabel: "Front Neck", options: ["Round Neck", "V-Neck"] },
    ] as never);

    const result = await getEffectiveDesignAttributesForCategory("co-1", "Dress");

    expect(result).toEqual([{ key: "neckline", label: "Front Neck", options: ["Round Neck", "V-Neck"] }]);
  });

  it("falls back to the built-in default when the company has customized nothing for the category", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findActiveByCategory).mockResolvedValue([]);

    const result = await getEffectiveDesignAttributesForCategory("co-1", "Dress");

    // The real built-in Dress default — confirms the fallback genuinely reaches the static catalog, not an empty list.
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((a) => a.key === "neckline")).toBe(true);
  });

  it("returns an empty list for an unknown category with no custom rows either", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findActiveByCategory).mockResolvedValue([]);

    const result = await getEffectiveDesignAttributesForCategory("co-1", "Not A Real Category");

    expect(result).toEqual([]);
  });
});

describe("createProductDesignAttribute", () => {
  it("rejects a duplicate (category, key) pair for the same company", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findByKey).mockResolvedValue({ id: "existing" } as never);

    await expect(
      createProductDesignAttribute(actor, { categoryName: "Dress", attributeKey: "neckline", attributeLabel: "Front Neck", options: ["Round Neck"], sortOrder: 0 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiDesignerProductDesignAttributeRepository.create).not.toHaveBeenCalled();
  });

  it("creates a new attribute scoped to the actor's own company", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findByKey).mockResolvedValue(null);
    vi.mocked(AiDesignerProductDesignAttributeRepository.create).mockResolvedValue({ id: "new-1" } as never);

    await createProductDesignAttribute(actor, {
      categoryName: "Dress",
      attributeKey: "backNeck",
      attributeLabel: "Back Neck",
      options: ["Deep Back Cut-Out", "Open Back Cut-Out"],
      sortOrder: 1,
    });

    expect(AiDesignerProductDesignAttributeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", categoryName: "Dress", attributeKey: "backNeck", createdByUserId: "user-1" })
    );
  });
});

describe("updateProductDesignAttribute", () => {
  it("throws NOT_FOUND for an id outside the actor's own company", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findAnyById).mockResolvedValue(null);

    await expect(updateProductDesignAttribute(actor, "other-co-attr", { isActive: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(AiDesignerProductDesignAttributeRepository.update).not.toHaveBeenCalled();
  });

  it("updates an owned attribute", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findAnyById).mockResolvedValue({
      id: "a1",
      attributeLabel: "Front Neck",
      options: ["Round Neck"],
      isActive: true,
    } as never);
    vi.mocked(AiDesignerProductDesignAttributeRepository.update).mockResolvedValue({ id: "a1", isActive: false } as never);

    const result = await updateProductDesignAttribute(actor, "a1", { isActive: false });

    expect(AiDesignerProductDesignAttributeRepository.update).toHaveBeenCalledWith("a1", { isActive: false });
    expect(result.isActive).toBe(false);
  });
});

describe("listAllKnownOptionValues", () => {
  it("includes the built-in catalog's values plus this company's own customized options, deduped", async () => {
    vi.mocked(AiDesignerProductDesignAttributeRepository.findMany).mockResolvedValue([
      { options: ["Round Neck", "A Brand New Custom Option"] },
    ] as never);

    const result = await listAllKnownOptionValues("co-1");

    // "Round Neck" is already in the built-in Dress catalog — must not appear twice.
    expect(result.filter((v) => v === "Round Neck")).toHaveLength(1);
    expect(result).toContain("A Brand New Custom Option");
    expect(result.length).toBeGreaterThan(50);
  });
});

describe("listOptionReferenceImages", () => {
  it("returns a flat optionValue -> attachmentId map", async () => {
    vi.mocked(AiDesignerOptionReferenceImageRepository.findMany).mockResolvedValue([
      { optionValue: "Deep Back Cut-Out", attachmentId: "att-1" },
      { optionValue: "Regular Back", attachmentId: "att-2" },
    ] as never);

    const result = await listOptionReferenceImages("co-1");

    expect(result).toEqual({ "Deep Back Cut-Out": "att-1", "Regular Back": "att-2" });
  });
});

describe("uploadOptionReferenceImage", () => {
  const file = { buffer: Buffer.from("x"), fileName: "photo.jpg", mimeType: "image/jpeg" };

  it("rejects an unsupported file type before touching any repository", async () => {
    await expect(uploadOptionReferenceImage(actor, "Deep Back Cut-Out", { ...file, mimeType: "application/pdf" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("creates a new override when none exists yet, with no old attachment to clean up", async () => {
    vi.mocked(AiDesignerOptionReferenceImageRepository.findByValue).mockResolvedValue(null);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);
    vi.mocked(AiDesignerOptionReferenceImageRepository.upsert).mockResolvedValue({ id: "row-1", optionValue: "Deep Back Cut-Out", attachmentId: "att-new" } as never);

    await uploadOptionReferenceImage(actor, "Deep Back Cut-Out", file);

    expect(AiDesignerOptionReferenceImageRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", optionValue: "Deep Back Cut-Out", attachmentId: "att-new", createdByUserId: "user-1" })
    );
    expect(deleteAttachment).not.toHaveBeenCalled();
  });

  it("deletes the old attachment when replacing an existing override", async () => {
    vi.mocked(AiDesignerOptionReferenceImageRepository.findByValue).mockResolvedValue({ id: "row-1", attachmentId: "att-old" } as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);
    vi.mocked(AiDesignerOptionReferenceImageRepository.upsert).mockResolvedValue({ id: "row-1", attachmentId: "att-new" } as never);

    await uploadOptionReferenceImage(actor, "Deep Back Cut-Out", file);

    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-old");
  });

  it("still succeeds even if deleting the replaced old attachment fails", async () => {
    vi.mocked(AiDesignerOptionReferenceImageRepository.findByValue).mockResolvedValue({ id: "row-1", attachmentId: "att-old" } as never);
    vi.mocked(uploadAttachment).mockResolvedValue({ id: "att-new" } as never);
    vi.mocked(AiDesignerOptionReferenceImageRepository.upsert).mockResolvedValue({ id: "row-1", attachmentId: "att-new" } as never);
    vi.mocked(deleteAttachment).mockRejectedValue(new Error("transient storage error"));

    await expect(uploadOptionReferenceImage(actor, "Deep Back Cut-Out", file)).resolves.toMatchObject({ attachmentId: "att-new" });
  });
});

describe("deleteOptionReferenceImage", () => {
  it("throws NOT_FOUND when no override exists for the value", async () => {
    vi.mocked(AiDesignerOptionReferenceImageRepository.findByValue).mockResolvedValue(null);

    await expect(deleteOptionReferenceImage(actor, "Deep Back Cut-Out")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(AiDesignerOptionReferenceImageRepository.deleteByValue).not.toHaveBeenCalled();
  });

  it("removes the override row and its attachment", async () => {
    vi.mocked(AiDesignerOptionReferenceImageRepository.findByValue).mockResolvedValue({ id: "row-1", attachmentId: "att-1" } as never);

    await deleteOptionReferenceImage(actor, "Deep Back Cut-Out");

    expect(AiDesignerOptionReferenceImageRepository.deleteByValue).toHaveBeenCalledWith("co-1", "Deep Back Cut-Out");
    expect(deleteAttachment).toHaveBeenCalledWith(actor, "att-1");
  });
});

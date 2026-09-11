import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./ai-designer.repository", () => ({
  AiDesignerProductDesignAttributeRepository: {
    findMany: vi.fn(),
    findActiveByCategory: vi.fn(),
    findAnyById: vi.fn(),
    findByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { AiDesignerProductDesignAttributeRepository } = await import("./ai-designer.repository");
const {
  createProductDesignAttribute,
  updateProductDesignAttribute,
  getEffectiveDesignAttributesForCategory,
} = await import("./ai-designer-attribute-master.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(AiDesignerProductDesignAttributeRepository.findMany).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.findActiveByCategory).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.findAnyById).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.findByKey).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.create).mockReset();
  vi.mocked(AiDesignerProductDesignAttributeRepository.update).mockReset();
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

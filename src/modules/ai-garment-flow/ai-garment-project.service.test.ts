import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  generateDocumentNumber: vi.fn(),
  advanceMasterCodeSequence: vi.fn(),
}));
vi.mock("@/modules/sampling/sample.service", () => ({ createSampleRequest: vi.fn() }));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findAnyById: vi.fn(), findByStyleCode: vi.fn(), create: vi.fn() },
}));
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("@/modules/garment-attributes/garment-attributes.repository", () => ({
  GarmentAttributeRepository: {
    brand: { findFirst: vi.fn() },
    season: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/fabric-config/fabric-config.repository", () => ({
  FabricConfigRepository: {
    gsm: { findFirst: vi.fn() },
    dye: { findFirst: vi.fn() },
    weaveType: { findFirst: vi.fn() },
    width: { findFirst: vi.fn() },
    composition: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { color: { findFirst: vi.fn() } },
}));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findAnyById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setProductIdGuarded: vi.fn(),
    setSampleRequestIdGuarded: vi.fn(),
  },
  AiGarmentFabricDetailRepository: { findByProjectId: vi.fn(), upsert: vi.fn() },
  AiGarmentDesignOptionRepository: {
    findByProjectId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    selectExclusive: vi.fn(),
  },
}));
vi.mock("./reference-analysis.repository", () => ({
  AiGarmentReferenceAnalysisRepository: { findByProjectId: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { countByStatus: vi.fn() },
}));

const { generateDocumentNumber, advanceMasterCodeSequence } = await import("@/core/numbering/DocumentNumberingService");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { createSampleRequest } = await import("@/modules/sampling/sample.service");
const { AiGarmentProjectRepository, AiGarmentDesignOptionRepository } = await import("./ai-garment-project.repository");
const { AiGarmentReferenceAnalysisRepository } = await import("./reference-analysis.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const {
  createAiGarmentProject,
  saveWorkflowStep,
  holdProject,
  resumeProject,
  cancelProject,
  convertProjectToStyle,
  createSampleRequestFromProject,
  selectDesignOption,
} = await import("./ai-garment-project.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("AGF-2026-00001");
  vi.mocked(advanceMasterCodeSequence).mockReset().mockResolvedValue(undefined);
  vi.mocked(AiGarmentProjectRepository.create).mockReset().mockImplementation(((data: Record<string, unknown>) => Promise.resolve({ id: "proj-1", ...data })) as never);
  vi.mocked(AiGarmentProjectRepository.findAnyById).mockReset();
  vi.mocked(AiGarmentProjectRepository.update).mockReset().mockImplementation(((id: string, data: Record<string, unknown>) => Promise.resolve({ id, ...data })) as never);
  vi.mocked(AiGarmentProjectRepository.setProductIdGuarded).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(AiGarmentProjectRepository.setSampleRequestIdGuarded).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(ProductRepository.findByStyleCode).mockReset().mockResolvedValue(null);
  vi.mocked(ProductRepository.create).mockReset().mockResolvedValue({ id: "prod-1", styleCode: "ST-001" } as never);
  vi.mocked(createSampleRequest).mockReset().mockResolvedValue({ id: "sam-1", requestNumber: "SAM-2026-00001" } as never);
  vi.mocked(AiGarmentDesignOptionRepository.findWithProjectOwner).mockReset();
  vi.mocked(AiGarmentDesignOptionRepository.selectExclusive).mockReset();
  // Default to "already past both Process 2 gates" so tests unrelated to those
  // gates (e.g. plain status-advance/never-regress checks) don't each need
  // their own setup — the gate-specific tests below override these.
  vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockReset().mockResolvedValue({ status: "APPROVED" } as never);
  vi.mocked(AiGarmentDesignDirectionRepository.countByStatus).mockReset().mockResolvedValue(1);
});

describe("createAiGarmentProject", () => {
  it("defaults a REFERENCE project to its first step and an empty completed list", async () => {
    await createAiGarmentProject(actor, { projectName: "Winter Jacket", sourceType: "REFERENCE" } as never);
    expect(AiGarmentProjectRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ currentStepKey: "PROJECT_INFO", completedStepKeys: [], status: "IDEA" })
    );
  });
});

describe("saveWorkflowStep — the state machine", () => {
  it("rejects a step key that doesn't belong to the project's own sourceType", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      sourceType: "REFERENCE",
      status: "IDEA",
      completedStepKeys: [],
    } as never);

    await expect(saveWorkflowStep(actor, "proj-1", { stepKey: "UPLOAD_FABRIC" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
  });

  it("advances the coarse status forward when a mapped step is saved", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      sourceType: "REFERENCE",
      status: "IDEA",
      completedStepKeys: ["PROJECT_INFO"],
    } as never);

    await saveWorkflowStep(actor, "proj-1", { stepKey: "SELECT_DESIGN" });

    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ currentStepKey: "SELECT_DESIGN", status: "DESIGN_SELECTED" })
    );
  });

  it("never regresses status when an earlier step is revisited", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      sourceType: "REFERENCE",
      status: "COSTING",
      completedStepKeys: ["PROJECT_INFO", "SELECT_DESIGN", "COSTING"],
    } as never);

    await saveWorkflowStep(actor, "proj-1", { stepKey: "SELECT_DESIGN" });

    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ currentStepKey: "SELECT_DESIGN", status: "COSTING" })
    );
  });

  it("rejects saving a step on a project that is ON_HOLD", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      sourceType: "REFERENCE",
      status: "ON_HOLD",
      completedStepKeys: [],
    } as never);

    await expect(saveWorkflowStep(actor, "proj-1", { stepKey: "PROJECT_INFO" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects saving a step on a CANCELLED project", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      sourceType: "REFERENCE",
      status: "CANCELLED",
      completedStepKeys: [],
    } as never);

    await expect(saveWorkflowStep(actor, "proj-1", { stepKey: "PROJECT_INFO" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  describe("Process 2 gates apply to any step at or past DEVELOPMENT_BRIEF, not just the exact next transition", () => {
    it("blocks entering DEVELOPMENT_BRIEF itself without an approved Reference Analysis", async () => {
      vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
        id: "proj-1",
        sourceType: "REFERENCE",
        status: "REFERENCE_ANALYSIS",
        completedStepKeys: ["PROJECT_INFO", "UPLOAD_REFERENCE", "REFERENCE_ANALYSIS"],
      } as never);
      vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);

      await expect(saveWorkflowStep(actor, "proj-1", { stepKey: "DEVELOPMENT_BRIEF" })).rejects.toMatchObject({
        code: "INVALID_STATE_TRANSITION",
      });
    });

    it("blocks jumping straight PAST DEVELOPMENT_BRIEF to a later step without an approved Reference Analysis (the bypass this gate closes)", async () => {
      vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
        id: "proj-1",
        sourceType: "REFERENCE",
        status: "REFERENCE_ANALYSIS",
        completedStepKeys: ["PROJECT_INFO", "UPLOAD_REFERENCE", "REFERENCE_ANALYSIS"],
      } as never);
      vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);

      // Jumping directly to SELECT_DESIGN (well past DEVELOPMENT_BRIEF) used to
      // slip past this gate entirely, since the old check only matched the
      // literal stepKey "DEVELOPMENT_BRIEF".
      await expect(saveWorkflowStep(actor, "proj-1", { stepKey: "SELECT_DESIGN" })).rejects.toMatchObject({
        code: "INVALID_STATE_TRANSITION",
      });
      expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
    });

    it("blocks jumping straight past DEVELOPMENT_BRIEF with zero approved design directions (the bypass this gate closes)", async () => {
      vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
        id: "proj-1",
        sourceType: "REFERENCE",
        status: "DESIGN_DEVELOPMENT",
        completedStepKeys: ["PROJECT_INFO", "UPLOAD_REFERENCE", "REFERENCE_ANALYSIS", "DEVELOPMENT_BRIEF"],
      } as never);
      vi.mocked(AiGarmentDesignDirectionRepository.countByStatus).mockResolvedValue(0);

      // Jumping directly to COMMERCIAL_EVALUATION (not the immediate next step,
      // GENERATE_VARIATIONS) used to slip past this gate entirely, since the
      // old check only matched the literal stepKey "GENERATE_VARIATIONS".
      await expect(saveWorkflowStep(actor, "proj-1", { stepKey: "COMMERCIAL_EVALUATION" })).rejects.toMatchObject({
        code: "INVALID_STATE_TRANSITION",
      });
      expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
    });

    it("allows jumping past DEVELOPMENT_BRIEF once both gates are satisfied", async () => {
      vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
        id: "proj-1",
        sourceType: "REFERENCE",
        status: "DESIGN_DEVELOPMENT",
        completedStepKeys: ["PROJECT_INFO", "UPLOAD_REFERENCE", "REFERENCE_ANALYSIS", "DEVELOPMENT_BRIEF"],
      } as never);

      await saveWorkflowStep(actor, "proj-1", { stepKey: "COMMERCIAL_EVALUATION" });

      expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ currentStepKey: "COMMERCIAL_EVALUATION" })
      );
    });

    it("does not gate steps before DEVELOPMENT_BRIEF at all", async () => {
      vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
        id: "proj-1",
        sourceType: "REFERENCE",
        status: "IDEA",
        completedStepKeys: [],
      } as never);
      vi.mocked(AiGarmentReferenceAnalysisRepository.findByProjectId).mockResolvedValue(null);

      await saveWorkflowStep(actor, "proj-1", { stepKey: "UPLOAD_REFERENCE" });

      expect(AiGarmentReferenceAnalysisRepository.findByProjectId).not.toHaveBeenCalled();
      expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ currentStepKey: "UPLOAD_REFERENCE" })
      );
    });
  });
});

describe("Hold / Resume", () => {
  it("holds a project and remembers its exact prior status", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({ id: "proj-1", status: "DESIGN_DEVELOPMENT" } as never);
    await holdProject(actor, "proj-1");
    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ status: "ON_HOLD", statusBeforeHold: "DESIGN_DEVELOPMENT" })
    );
  });

  it("resumes to the exact remembered status, not a caller-chosen one", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      status: "ON_HOLD",
      statusBeforeHold: "DESIGN_DEVELOPMENT",
    } as never);
    await resumeProject(actor, "proj-1");
    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ status: "DESIGN_DEVELOPMENT", statusBeforeHold: null })
    );
  });

  it("rejects resuming a project that isn't on hold", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      status: "IDEA",
      statusBeforeHold: null,
    } as never);
    await expect(resumeProject(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects holding an already-terminal project", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({ id: "proj-1", status: "CANCELLED" } as never);
    await expect(holdProject(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("cancelProject", () => {
  it("rejects cancelling an already-completed project", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({ id: "proj-1", status: "COMPLETED" } as never);
    await expect(cancelProject(actor, "proj-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("convertProjectToStyle — the graduation guard", () => {
  const readyProject = { id: "proj-1", status: "DESIGN_SELECTED", productId: null, customerId: "cust-1", categoryId: null, seasonId: null, brandId: null };

  it("blocks conversion before a design has been selected", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({ ...readyProject, status: "DESIGN_DEVELOPMENT" } as never);
    await expect(
      convertProjectToStyle(actor, "proj-1", { styleCode: "ST-001", styleName: "Winter Jacket" })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(ProductRepository.create).not.toHaveBeenCalled();
  });

  it("blocks a second conversion once productId is already set", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({ ...readyProject, productId: "prod-existing" } as never);
    await expect(
      convertProjectToStyle(actor, "proj-1", { styleCode: "ST-001", styleName: "Winter Jacket" })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
    expect(ProductRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a style code already in use", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(readyProject as never);
    vi.mocked(ProductRepository.findByStyleCode).mockResolvedValue({ id: "other-prod" } as never);
    await expect(
      convertProjectToStyle(actor, "proj-1", { styleCode: "ST-001", styleName: "Winter Jacket" })
    ).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(ProductRepository.create).not.toHaveBeenCalled();
  });

  it("creates a real STYLE Product and links it back once every guard passes", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById)
      .mockResolvedValueOnce(readyProject as never)
      .mockResolvedValueOnce({ ...readyProject, productId: "prod-1" } as never);

    const result = await convertProjectToStyle(actor, "proj-1", { styleCode: "ST-001", styleName: "Winter Jacket" });

    expect(ProductRepository.create).toHaveBeenCalledWith(expect.objectContaining({ itemType: "STYLE", styleCode: "ST-001" }));
    expect(advanceMasterCodeSequence).toHaveBeenCalledWith("co-1", "STYLE");
    expect(AiGarmentProjectRepository.setProductIdGuarded).toHaveBeenCalledWith("proj-1", "prod-1");
    expect(result.product.id).toBe("prod-1");
  });

  it("surfaces a lost conversion race as REFERENCED_RECORD_IN_USE rather than silently double-linking", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue(readyProject as never);
    vi.mocked(AiGarmentProjectRepository.setProductIdGuarded).mockResolvedValue({ count: 0 } as never);

    await expect(
      convertProjectToStyle(actor, "proj-1", { styleCode: "ST-001", styleName: "Winter Jacket" })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });
});

describe("createSampleRequestFromProject — the graduation guard", () => {
  it("blocks creating a Sample Request before the project has a real Style", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      productId: null,
      sampleRequestId: null,
      customerId: "cust-1",
    } as never);

    await expect(
      createSampleRequestFromProject(actor, "proj-1", { sampleType: "PP" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createSampleRequest).not.toHaveBeenCalled();
  });

  it("blocks a project that already has a linked Sample Request", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      productId: "prod-1",
      sampleRequestId: "sam-existing",
      customerId: "cust-1",
    } as never);

    await expect(
      createSampleRequestFromProject(actor, "proj-1", { sampleType: "PP" })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
    expect(createSampleRequest).not.toHaveBeenCalled();
  });

  it("blocks a project with no linked Customer", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById).mockResolvedValue({
      id: "proj-1",
      productId: "prod-1",
      sampleRequestId: null,
      customerId: null,
    } as never);

    await expect(
      createSampleRequestFromProject(actor, "proj-1", { sampleType: "PP" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createSampleRequest).not.toHaveBeenCalled();
  });

  it("creates and links a real Sample Request once every guard passes", async () => {
    vi.mocked(AiGarmentProjectRepository.findAnyById)
      .mockResolvedValueOnce({
        id: "proj-1",
        productId: "prod-1",
        sampleRequestId: null,
        customerId: "cust-1",
        buyerId: null,
        projectName: "Winter Jacket",
      } as never)
      .mockResolvedValueOnce({ id: "proj-1", sampleRequestId: "sam-1" } as never);

    const result = await createSampleRequestFromProject(actor, "proj-1", { sampleType: "PP" });

    expect(createSampleRequest).toHaveBeenCalledWith(actor, expect.objectContaining({ customerId: "cust-1", productId: "prod-1" }));
    expect(AiGarmentProjectRepository.setSampleRequestIdGuarded).toHaveBeenCalledWith("proj-1", "sam-1");
    expect(result.sampleRequest.id).toBe("sam-1");
  });
});

describe("selectDesignOption", () => {
  it("rejects a design option belonging to another company", async () => {
    vi.mocked(AiGarmentDesignOptionRepository.findWithProjectOwner).mockResolvedValue({
      id: "opt-1",
      projectId: "proj-1",
      project: { companyId: "other-co", status: "DESIGN_DEVELOPMENT" },
    } as never);

    await expect(selectDesignOption(actor, "opt-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(AiGarmentDesignOptionRepository.selectExclusive).not.toHaveBeenCalled();
  });

  it("selects the option exclusively within its project once ownership checks out", async () => {
    vi.mocked(AiGarmentDesignOptionRepository.findWithProjectOwner).mockResolvedValue({
      id: "opt-1",
      projectId: "proj-1",
      project: { companyId: "co-1", status: "DESIGN_DEVELOPMENT" },
    } as never);

    await selectDesignOption(actor, "opt-1");

    expect(AiGarmentDesignOptionRepository.selectExclusive).toHaveBeenCalledWith("proj-1", "opt-1");
  });
});

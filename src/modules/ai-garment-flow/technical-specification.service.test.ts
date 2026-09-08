import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/technical-specification/generate", () => ({
  generateTechnicalSpecification: vi.fn(),
  AiConfigMissingError: class AiConfigMissingError extends Error {},
  AiInvalidResponseError: class AiInvalidResponseError extends Error {},
  AiServiceError: class AiServiceError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.category = category;
    }
  },
  PROMPT_VERSION: "technical-specification-v1",
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { size: { findMany: vi.fn() } },
}));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn(), update: vi.fn() },
}));
vi.mock("./development-brief.repository", () => ({
  AiGarmentDesignDirectionRepository: { findById: vi.fn() },
}));
vi.mock("./fabric-detail-description", () => ({ describeFabricDetail: vi.fn().mockReturnValue(null) }));
vi.mock("./ai-garment-project.service", () => ({ saveWorkflowStep: vi.fn() }));
vi.mock("./technical-specification.repository", () => ({
  AiGarmentTechnicalSpecificationRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentTechnicalSpecificationRepository: {
    create: vi.fn(),
    findByDesignDirectionId: vi.fn(),
    findWithProjectOwner: vi.fn(),
    approveExclusive: vi.fn(),
    revertToPending: vi.fn(),
  },
  AiGarmentMeasurementValueRepository: { findWithSpecOwner: vi.fn(), update: vi.fn() },
}));

const { generateTechnicalSpecification: callAi, AiConfigMissingError, AiServiceError } = await import(
  "@/core/ai/technical-specification/generate"
);
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentDesignDirectionRepository } = await import("./development-brief.repository");
const { saveWorkflowStep } = await import("./ai-garment-project.service");
const {
  AiGarmentTechnicalSpecificationRunRepository,
  AiGarmentTechnicalSpecificationRepository,
  AiGarmentMeasurementValueRepository,
} = await import("./technical-specification.repository");
const {
  createTechnicalSpecification,
  listTechnicalSpecifications,
  updateMeasurementValue,
  resetMeasurementValueToAi,
  decideTechnicalSpecification,
  approveTechnicalSpecification,
} = await import("./technical-specification.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sourceType: "REFERENCE",
  selectedDesignDirectionId: "dir-1",
  approvedTechnicalSpecificationId: null as string | null,
  fabricDetail: null,
};

const baseDirection = {
  id: "dir-1",
  designDirectionName: "Classic Crew Neck Tee",
  silhouette: "Boxy",
  garmentLength: "Regular",
  fit: "Relaxed",
  neckline: "Round",
  collar: "None",
  sleeve: "Short",
  shoulderConstruction: "Set-in",
  frontConstruction: "Plain",
  backConstruction: "Plain",
  closure: "Pullover",
  pocket: "None",
  waistTreatment: "Straight hem",
  hem: "Straight",
};

const activeSizes = [
  { id: "size-s", code: "S", name: "Small", sortOrder: 1 },
  { id: "size-m", code: "M", name: "Medium", sortOrder: 2 },
  { id: "size-l", code: "L", name: "Large", sortOrder: 3 },
];

const aiResult = {
  data: {
    generalNotes: "Assumes a standard +/-2cm per size step; verify grade rules before cutting.",
    measurementPoints: [
      { measurementName: "Chest Width", howToMeasure: "1in below armhole, flat", toleranceText: "+/- 1 cm", values: ["48", "50", "52"] },
      { measurementName: "Body Length", howToMeasure: "HPS to hem", toleranceText: "+/- 1 cm", values: ["68", "70", "72"] },
    ],
  },
  model: "claude-sonnet-5",
  rawResponse: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentDesignDirectionRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(baseDirection);
  (LookupRepository.size.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(activeSizes);
  (AiGarmentTechnicalSpecificationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentTechnicalSpecificationRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (AiGarmentTechnicalSpecificationRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "spec-1" });
  (AiGarmentTechnicalSpecificationRepository.findByDesignDirectionId as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "spec-1" }]);
  (callAi as ReturnType<typeof vi.fn>).mockResolvedValue(aiResult);
});

describe("createTechnicalSpecification", () => {
  it("blocks generation before a design has been selected", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    await expect(createTechnicalSpecification(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("rejects cleanly when the company has zero active Sizes", async () => {
    (LookupRepository.size.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await expect(createTechnicalSpecification(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiGarmentTechnicalSpecificationRunRepository.create).not.toHaveBeenCalled();
  });

  it("blocks a duplicate request while a run is already in progress for this design", async () => {
    (AiGarmentTechnicalSpecificationRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(createTechnicalSpecification(actor, "proj-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiConfigMissingError("AI service configuration is missing."));

    await expect(createTechnicalSpecification(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentTechnicalSpecificationRunRepository.markFailed).toHaveBeenCalledWith(
      "run-1",
      "MISSING_CONFIG",
      "AI service configuration is missing."
    );
    expect(AiGarmentTechnicalSpecificationRepository.create).not.toHaveBeenCalled();
  });

  it("maps a real AI service failure without persisting a partial/fabricated result", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiServiceError("Timed out.", "TIMEOUT"));
    await expect(createTechnicalSpecification(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentTechnicalSpecificationRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
    expect(AiGarmentTechnicalSpecificationRepository.create).not.toHaveBeenCalled();
  });

  it("maps each point's values positionally to the real Size ids, in the same order sizes were sent, on success", async () => {
    await createTechnicalSpecification(actor, "proj-1", {});

    const [, points] = (AiGarmentTechnicalSpecificationRepository.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(points).toEqual([
      expect.objectContaining({
        measurementName: "Chest Width",
        values: [
          { sizeId: "size-s", aiValueText: "48", approvedValueText: "48" },
          { sizeId: "size-m", aiValueText: "50", approvedValueText: "50" },
          { sizeId: "size-l", aiValueText: "52", approvedValueText: "52" },
        ],
      }),
      expect.objectContaining({ measurementName: "Body Length" }),
    ]);
    expect(AiGarmentTechnicalSpecificationRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("listTechnicalSpecifications", () => {
  it("returns an empty list, not an error, when no design has been selected yet", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      selectedDesignDirectionId: null,
    });
    const result = await listTechnicalSpecifications("co-1", "proj-1");
    expect(result).toEqual([]);
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(listTechnicalSpecifications("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateMeasurementValue / resetMeasurementValueToAi", () => {
  const pendingValue = {
    id: "value-1",
    aiValueText: "48",
    approvedValueText: "48",
    userEdited: false,
    measurementPoint: {
      technicalSpecification: { id: "spec-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } },
    },
  };

  beforeEach(() => {
    (AiGarmentMeasurementValueRepository.findWithSpecOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingValue);
    (AiGarmentMeasurementValueRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "value-1" });
  });

  it("rejects a value that doesn't belong to this company", async () => {
    (AiGarmentMeasurementValueRepository.findWithSpecOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingValue,
      measurementPoint: {
        technicalSpecification: { id: "spec-1", decision: "PENDING", project: { id: "proj-1", companyId: "other-co" } },
      },
    });
    await expect(updateMeasurementValue(actor, "value-1", { approvedValueText: "49" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("edits the value and does not revert an already-PENDING specification", async () => {
    await updateMeasurementValue(actor, "value-1", { approvedValueText: "49" });
    expect(AiGarmentTechnicalSpecificationRepository.revertToPending).not.toHaveBeenCalled();
    expect(AiGarmentMeasurementValueRepository.update).toHaveBeenCalledWith("value-1", { approvedValueText: "49", userEdited: true });
  });

  it("reverts an APPROVED specification back to PENDING when a value is edited", async () => {
    (AiGarmentMeasurementValueRepository.findWithSpecOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingValue,
      measurementPoint: {
        technicalSpecification: { id: "spec-1", decision: "APPROVED", project: { id: "proj-1", companyId: "co-1" } },
      },
    });
    await updateMeasurementValue(actor, "value-1", { approvedValueText: "49" });
    expect(AiGarmentTechnicalSpecificationRepository.revertToPending).toHaveBeenCalledWith("spec-1");
  });

  it("resets to the AI's own original value and clears userEdited", async () => {
    await resetMeasurementValueToAi(actor, "value-1");
    expect(AiGarmentMeasurementValueRepository.update).toHaveBeenCalledWith("value-1", { approvedValueText: "48", userEdited: false });
  });
});

describe("decideTechnicalSpecification", () => {
  const pendingSpec = { id: "spec-1", designDirectionId: "dir-1", decision: "PENDING", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentTechnicalSpecificationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(pendingSpec);
    (AiGarmentTechnicalSpecificationRepository.approveExclusive as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "spec-1",
      decision: "APPROVED",
    });
  });

  it("rejects a specification that doesn't belong to this company", async () => {
    (AiGarmentTechnicalSpecificationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...pendingSpec,
      project: { id: "proj-1", companyId: "other-co" },
    });
    await expect(decideTechnicalSpecification(actor, "spec-1", { decision: "APPROVE", confirmed: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires explicit confirmation", async () => {
    await expect(decideTechnicalSpecification(actor, "spec-1", { decision: "APPROVE", confirmed: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(AiGarmentTechnicalSpecificationRepository.approveExclusive).not.toHaveBeenCalled();
  });

  it("approves exclusively once confirmed", async () => {
    await decideTechnicalSpecification(actor, "spec-1", { decision: "APPROVE", confirmed: true });
    expect(AiGarmentTechnicalSpecificationRepository.approveExclusive).toHaveBeenCalledWith("dir-1", "spec-1");
  });
});

describe("approveTechnicalSpecification", () => {
  const approvedSpec = { id: "spec-1", projectId: "proj-1", decision: "APPROVED", project: { id: "proj-1", companyId: "co-1" } };

  beforeEach(() => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
    (AiGarmentTechnicalSpecificationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue(approvedSpec);
    (AiGarmentProjectRepository.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "proj-1",
      approvedTechnicalSpecificationId: "spec-1",
    });
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      approveTechnicalSpecification(actor, "proj-x", { technicalSpecificationId: "spec-1", confirmed: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires explicit confirmation", async () => {
    await expect(
      approveTechnicalSpecification(actor, "proj-1", { technicalSpecificationId: "spec-1", confirmed: false })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(AiGarmentProjectRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a technical specification that hasn't been approved yet", async () => {
    (AiGarmentTechnicalSpecificationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedSpec,
      decision: "PENDING",
    });
    await expect(
      approveTechnicalSpecification(actor, "proj-1", { technicalSpecificationId: "spec-1", confirmed: true })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a technical specification belonging to a different project", async () => {
    (AiGarmentTechnicalSpecificationRepository.findWithProjectOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...approvedSpec,
      projectId: "other-proj",
    });
    await expect(
      approveTechnicalSpecification(actor, "proj-1", { technicalSpecificationId: "spec-1", confirmed: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records the approved specification and advances the workflow to BOM", async () => {
    await approveTechnicalSpecification(actor, "proj-1", { technicalSpecificationId: "spec-1", confirmed: true });

    expect(AiGarmentProjectRepository.update).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ approvedTechnicalSpecificationId: "spec-1", approvedTechnicalSpecificationByUserId: "user-1" })
    );
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(1, actor, "proj-1", { stepKey: "TECHNICAL_DEVELOPMENT" });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "BOM" });
  });

  it("advances a FABRIC-sourced project (no APPLY_FABRIC step) to BOM the same way", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, sourceType: "FABRIC" });
    await approveTechnicalSpecification(actor, "proj-1", { technicalSpecificationId: "spec-1", confirmed: true });
    expect(saveWorkflowStep).toHaveBeenNthCalledWith(2, actor, "proj-1", { stepKey: "BOM" });
  });
});

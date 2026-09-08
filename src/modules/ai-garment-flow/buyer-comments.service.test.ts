import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/ai/buyer-comments/generate", () => ({
  generateBuyerComments: vi.fn(),
  AiConfigMissingError: class AiConfigMissingError extends Error {},
  AiInvalidResponseError: class AiInvalidResponseError extends Error {},
  AiServiceError: class AiServiceError extends Error {
    category: string;
    constructor(message: string, category: string) {
      super(message);
      this.category = category;
    }
  },
  PROMPT_VERSION: "buyer-comments-v1",
}));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleCommentRepository: { findAllForRequest: vi.fn() },
  SampleApprovalRepository: { findAllForRequest: vi.fn() },
}));
vi.mock("./ai-garment-project.repository", () => ({
  AiGarmentProjectRepository: { findByIdWithDetails: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("./buyer-comments.repository", () => ({
  AiGarmentBuyerCommentsRunRepository: { create: vi.fn(), findActiveSince: vi.fn(), markSuccess: vi.fn(), markFailed: vi.fn() },
  AiGarmentBuyerCommentsRepository: { create: vi.fn(), findLatestByProjectId: vi.fn() },
}));

const { generateBuyerComments: callAi, AiConfigMissingError, AiServiceError } = await import("@/core/ai/buyer-comments/generate");
const { SampleCommentRepository, SampleApprovalRepository } = await import("@/modules/sampling/sample.repository");
const { AiGarmentProjectRepository } = await import("./ai-garment-project.repository");
const { AiGarmentBuyerCommentsRunRepository, AiGarmentBuyerCommentsRepository } = await import("./buyer-comments.repository");
const { generateBuyerCommentsSummary, getLatestBuyerCommentsSummary } = await import("./buyer-comments.service");

const actor = { companyId: "co-1", userId: "user-1" };

const baseProject = {
  id: "proj-1",
  companyId: "co-1",
  sampleRequestId: "sam-1",
  sampleRequest: { id: "sam-1", requestNumber: "SAM-2026-00001", status: "SUBMITTED_TO_CUSTOMER" },
  product: { id: "style-1", styleCode: "ST-1", styleName: "Classic Tee" },
};

const realComment = {
  id: "cmt-1",
  body: "The neckline gapes too much.",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  author: { id: "u-2", fullName: "Buyer Contact" },
};

const decisionWithNotes = {
  id: "app-1",
  decision: "REVISION_REQUESTED",
  decisionNotes: "Please tighten the neckline ribbing.",
  decidedAt: new Date("2026-09-02T00:00:00Z"),
};

const decisionWithoutNotes = {
  id: "app-2",
  decision: "APPROVED",
  decisionNotes: null,
  decidedAt: new Date("2026-09-03T00:00:00Z"),
};

const aiResult = {
  data: {
    overallSummary: "The buyer wants the neckline tightened before approving.",
    categories: [
      {
        category: "FIT" as const,
        summary: "The neckline gapes and needs tightening.",
        evidenceExcerpt: "Please tighten the neckline ribbing.",
      },
    ],
  },
  model: "claude-sonnet-5",
  rawResponse: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(baseProject);
  (SampleCommentRepository.findAllForRequest as ReturnType<typeof vi.fn>).mockResolvedValue([realComment]);
  (SampleApprovalRepository.findAllForRequest as ReturnType<typeof vi.fn>).mockResolvedValue([decisionWithNotes, decisionWithoutNotes]);
  (AiGarmentBuyerCommentsRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (AiGarmentBuyerCommentsRunRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "run-1" });
  (AiGarmentBuyerCommentsRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "analysis-1",
    categories: [{ id: "cat-1" }],
  });
  (callAi as ReturnType<typeof vi.fn>).mockResolvedValue(aiResult);
});

describe("generateBuyerCommentsSummary", () => {
  it("rejects a project with no Sample Request linked yet", async () => {
    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseProject,
      sampleRequestId: null,
      sampleRequest: null,
    });
    await expect(generateBuyerCommentsSummary(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("rejects when there are zero real comments and zero decisions with notes", async () => {
    (SampleCommentRepository.findAllForRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (SampleApprovalRepository.findAllForRequest as ReturnType<typeof vi.fn>).mockResolvedValue([decisionWithoutNotes]);
    await expect(generateBuyerCommentsSummary(actor, "proj-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(callAi).not.toHaveBeenCalled();
  });

  it("succeeds on decision notes alone, with zero real comments", async () => {
    (SampleCommentRepository.findAllForRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await generateBuyerCommentsSummary(actor, "proj-1", {});
    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ comments: [] }));
  });

  it("filters out decisions with no notes before building the AI context", async () => {
    await generateBuyerCommentsSummary(actor, "proj-1", {});
    expect(callAi).toHaveBeenCalledWith(
      expect.objectContaining({
        decisions: [expect.objectContaining({ decision: "REVISION_REQUESTED", decisionNotes: "Please tighten the neckline ribbing." })],
      })
    );
  });

  it("resolves styleName from the project's own graduated Style, falling back to null", async () => {
    await generateBuyerCommentsSummary(actor, "proj-1", {});
    expect(callAi).toHaveBeenCalledWith(expect.objectContaining({ styleName: "Classic Tee", sampleRequestNumber: "SAM-2026-00001" }));

    (AiGarmentProjectRepository.findByIdWithDetails as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseProject, product: null });
    await generateBuyerCommentsSummary(actor, "proj-1", {});
    expect(callAi).toHaveBeenLastCalledWith(expect.objectContaining({ styleName: null }));
  });

  it("rejects a second call while one is already in progress for this project", async () => {
    (AiGarmentBuyerCommentsRunRepository.findActiveSince as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "active-run" });
    await expect(generateBuyerCommentsSummary(actor, "proj-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("maps a missing-config failure to AI_SERVICE_ERROR and marks the run FAILED", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiConfigMissingError("ANTHROPIC_API_KEY is missing."));

    await expect(generateBuyerCommentsSummary(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });

    expect(AiGarmentBuyerCommentsRunRepository.create).toHaveBeenCalledTimes(1);
    expect(AiGarmentBuyerCommentsRunRepository.markFailed).toHaveBeenCalledWith("run-1", "MISSING_CONFIG", expect.any(String));
    expect(AiGarmentBuyerCommentsRepository.create).not.toHaveBeenCalled();
  });

  it("marks the run FAILED with the provider's real error category on a genuine provider failure", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockRejectedValue(new AiServiceError("Timed out.", "TIMEOUT"));
    await expect(generateBuyerCommentsSummary(actor, "proj-1", {})).rejects.toMatchObject({ code: "AI_SERVICE_ERROR" });
    expect(AiGarmentBuyerCommentsRunRepository.markFailed).toHaveBeenCalledWith("run-1", "TIMEOUT", expect.any(String));
  });

  it("persists the analysis with its categories and marks the run SUCCESS", async () => {
    await generateBuyerCommentsSummary(actor, "proj-1", {});

    expect(AiGarmentBuyerCommentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        overallSummary: "The buyer wants the neckline tightened before approving.",
      }),
      [
        expect.objectContaining({
          category: "FIT",
          summary: "The neckline gapes and needs tightening.",
          evidenceExcerpt: "Please tighten the neckline ribbing.",
          sortOrder: 0,
        }),
      ]
    );
    expect(AiGarmentBuyerCommentsRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });

  it("persists a genuinely empty category list as a valid, honest result (not an error)", async () => {
    (callAi as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { overallSummary: "The buyer left only general positive feedback.", categories: [] },
      model: "claude-sonnet-5",
      rawResponse: {},
    });

    await generateBuyerCommentsSummary(actor, "proj-1", {});

    expect(AiGarmentBuyerCommentsRepository.create).toHaveBeenCalledWith(expect.anything(), []);
    expect(AiGarmentBuyerCommentsRunRepository.markSuccess).toHaveBeenCalledWith("run-1");
  });
});

describe("getLatestBuyerCommentsSummary", () => {
  it("returns null, not an error, when nothing has been generated yet", async () => {
    (AiGarmentBuyerCommentsRepository.findLatestByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await getLatestBuyerCommentsSummary("co-1", "proj-1");
    expect(result).toBeNull();
  });

  it("rejects a project that doesn't belong to this company", async () => {
    (AiGarmentProjectRepository.findAnyById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getLatestBuyerCommentsSummary("co-1", "proj-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

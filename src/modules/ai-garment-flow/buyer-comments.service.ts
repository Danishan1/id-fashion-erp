import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateBuyerComments as callBuyerCommentsAi,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/buyer-comments/generate";
import type { BuyerCommentsContext, RealCommentForPrompt, RealDecisionForPrompt } from "@/core/ai/buyer-comments/prompt";
import { SampleCommentRepository, SampleApprovalRepository } from "@/modules/sampling/sample.repository";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentBuyerCommentsRunRepository, AiGarmentBuyerCommentsRepository } from "./buyer-comments.repository";
import type { GenerateBuyerCommentsInput } from "./buyer-comments.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 2/5/6/7/8/9/14 use for their own larger/slower AI calls.
const RUN_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

function errorCategoryFor(err: unknown): string {
  if (err instanceof AiConfigMissingError) return "MISSING_CONFIG";
  if (err instanceof AiInvalidResponseError) return "INVALID_STRUCTURED_RESPONSE";
  if (err instanceof AiServiceError) return err.category;
  return "UNKNOWN";
}

function mapAiError(err: unknown): never {
  if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
    const code = err instanceof AiInvalidResponseError ? "AI_INVALID_RESPONSE" : "AI_SERVICE_ERROR";
    throw new BusinessRuleError(code, err.message);
  }
  throw err;
}

async function getOwnedProject(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return project;
}

/**
 * "SUMMARISE BUYER COMMENTS" — unlike every other AI Garment Flow process,
 * this one has no free-text guidance input at all: it reads only the real,
 * already-recorded comment thread and decision notes on the linked Sample
 * Request, never a user-supplied steer, since the whole point is that it
 * must never invent or bias what the buyer actually said.
 */
export async function generateBuyerCommentsSummary(actor: ActorContext, projectId: string, _input: GenerateBuyerCommentsInput) {
  void _input; // deliberately empty schema — see buyer-comments.schema.ts's own comment
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.sampleRequestId || !project.sampleRequest) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Create a Sample Request from this project first (Costing step).");
  }

  const [comments, allDecisions] = await Promise.all([
    SampleCommentRepository.findAllForRequest(project.sampleRequestId),
    SampleApprovalRepository.findAllForRequest(project.sampleRequestId),
  ]);
  const decisionsWithNotes = allDecisions.filter((d) => d.decisionNotes && d.decisionNotes.trim().length > 0);

  if (comments.length === 0 && decisionsWithNotes.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No buyer comments or decision notes have been recorded on the linked Sample Request yet."
    );
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentBuyerCommentsRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A buyer comments summary is already being generated for this project.", {
      runId: activeRun.id,
    });
  }

  const commentsForPrompt: RealCommentForPrompt[] = comments.map((c) => ({
    authorName: c.author.fullName,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }));
  const decisionsForPrompt: RealDecisionForPrompt[] = decisionsWithNotes.map((d) => ({
    decision: d.decision,
    decisionNotes: d.decisionNotes!,
    decidedAt: d.decidedAt.toISOString(),
  }));

  const context: BuyerCommentsContext = {
    sampleRequestNumber: project.sampleRequest.requestNumber,
    styleName: project.product?.styleName ?? null,
    comments: commentsForPrompt,
    decisions: decisionsForPrompt,
  };

  const run = await AiGarmentBuyerCommentsRunRepository.create({
    companyId: actor.companyId,
    projectId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    promptText: JSON.stringify(context),
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await callBuyerCommentsAi(context);

    const analysis = await AiGarmentBuyerCommentsRepository.create(
      {
        companyId: actor.companyId,
        projectId,
        runId: run.id,
        overallSummary: result.data.overallSummary,
        createdByUserId: actor.userId,
      },
      result.data.categories.map((c, index) => ({
        category: c.category,
        summary: c.summary,
        evidenceExcerpt: c.evidenceExcerpt,
        sortOrder: index,
      }))
    );

    await AiGarmentBuyerCommentsRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_buyer_comments_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { projectId, categoryCount: analysis.categories.length },
    });

    return analysis;
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentBuyerCommentsRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/** Null (not an error) when no summary has been generated yet, matching every other AI Garment Flow single-result endpoint's own empty state. */
export async function getLatestBuyerCommentsSummary(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return AiGarmentBuyerCommentsRepository.findLatestByProjectId(projectId);
}

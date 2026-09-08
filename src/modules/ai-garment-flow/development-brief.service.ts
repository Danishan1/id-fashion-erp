import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateDevelopmentBrief,
  regenerateDesignDirection as aiRegenerateDesignDirection,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/development-brief/generate";
import type { DevelopmentBriefContext } from "@/core/ai/development-brief/prompt";
import type { Prisma } from "@prisma/client";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentReferenceAnalysisRepository } from "./reference-analysis.repository";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import {
  AiGarmentDesignDirectionRepository,
  AiGarmentDevelopmentBriefRunRepository,
} from "./development-brief.repository";
import { directionToRow } from "./design-direction-row";
import { buildFabricContextForRegenerate, regenerateFabricDesignDirectionAi } from "./fabric-development-brief.service";
import type {
  CreateDevelopmentBriefInput,
  EditDesignDirectionInput,
  DesignDirectionDecisionInput,
} from "./development-brief.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

const RUN_FRESHNESS_WINDOW_MS = 5 * 60 * 1000; // longer than Process 1's — a 9-direction batch takes longer to generate

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

/** Resolves the Style Master + approved Reference Analysis + the short form's own values into the AI prompt's context — never any unrelated company data. */
/** Same shape as CreateDevelopmentBriefInput but with directionCount widened to a plain number — Regenerate always requests exactly 1, outside the 3/6/9 choice the create form itself is restricted to. */
type BriefContextOverrides = Omit<CreateDevelopmentBriefInput, "directionCount"> & { directionCount: number };

async function buildContext(
  companyId: string,
  projectId: string,
  overrides: BriefContextOverrides
): Promise<{ context: DevelopmentBriefContext; referenceAnalysisId: string; contextSnapshot: Record<string, unknown> }> {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });

  const analysis = await AiGarmentReferenceAnalysisRepository.findByProjectId(projectId);
  if (!analysis || analysis.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "The Reference Garment Analysis must be approved before creating a Development Brief."
    );
  }

  const garmentCategoryObs = analysis.observations.find((o) => o.featureKey === "garmentCategory")?.approvedObservation;
  const silhouetteObs = analysis.observations.find((o) => o.featureKey === "silhouette")?.approvedObservation;

  let seasonName: string | null = null;
  if (overrides.seasonId) {
    const season = await GarmentAttributeRepository.season.findFirst({ where: { id: overrides.seasonId, companyId } });
    if (!season) throw new BusinessRuleError("NOT_FOUND", "Season not found.", { id: overrides.seasonId });
    seasonName = season.name;
  } else if (project.season) {
    seasonName = project.season.name;
  }

  let categoryName: string | null = null;
  if (overrides.categoryId) {
    const category = await GarmentAttributeRepository.category.findFirst({ where: { id: overrides.categoryId, companyId } });
    if (!category) throw new BusinessRuleError("NOT_FOUND", "Category not found.", { id: overrides.categoryId });
    categoryName = category.name;
  } else if (project.category) {
    categoryName = project.category.name;
  }

  let buyerName: string | null = null;
  if (overrides.buyerId) {
    const customer = project.customerId
      ? await CustomerRepository.findByIdWithBuyers(companyId, project.customerId)
      : null;
    const buyer = customer?.buyers.find((b) => b.id === overrides.buyerId);
    if (!buyer) throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: overrides.buyerId });
    buyerName = buyer.name;
  } else if (project.buyer) {
    buyerName = project.buyer.name;
  }

  const targetMarket = overrides.targetMarket || project.targetMarket || null;
  const targetCustomerProfile = overrides.targetCustomerProfile || project.targetCustomerProfile || null;
  const targetSellingPrice = overrides.targetSellingPrice ?? (project.targetSellingPrice ? Number(project.targetSellingPrice) : null);
  const currencyCode = overrides.currencyCode || project.currencyCode || null;
  const preferredFabric = overrides.preferredFabric || null;
  const factoryCapabilities = overrides.factoryCapabilities || null;

  const context: DevelopmentBriefContext = {
    directionCount: overrides.directionCount,
    designBalance: overrides.designBalance,
    targetMarket,
    targetCustomerProfile,
    season: seasonName,
    garmentCategory: categoryName,
    targetSellingPrice,
    currencyCode,
    preferredFabric,
    factoryCapabilities,
    buyer: buyerName,
    designDnaSummary: analysis.designDnaSummary ?? "",
    keyDesignLanguageFeatures: analysis.keyDesignLanguageFeatures,
    featuresForFurtherDevelopment: analysis.featuresForFurtherDevelopment,
    featuresToChangeForDifferentiation: analysis.featuresToChangeForDifferentiation,
    constructionComplexityLevel: analysis.constructionComplexityLevel,
    garmentCategoryObservation: garmentCategoryObs,
    silhouetteObservation: silhouetteObs,
  };

  const contextSnapshot = {
    targetMarket,
    targetCustomerProfile,
    season: seasonName,
    garmentCategory: categoryName,
    targetSellingPrice,
    currencyCode,
    preferredFabric,
    factoryCapabilities,
    buyer: buyerName,
  };

  return { context, referenceAnalysisId: analysis.id, contextSnapshot };
}

// directionToRow lives in ./design-direction-row.ts now — shared with
// fabric-development-brief.service.ts, which produces the exact same
// 24-field shape into the exact same table. Kept in a neutral file so
// neither service needs to import the other for it.

export async function createDevelopmentBrief(actor: ActorContext, projectId: string, input: CreateDevelopmentBriefInput) {
  const { context, referenceAnalysisId, contextSnapshot } = await buildContext(actor.companyId, projectId, input);

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentDevelopmentBriefRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A development brief is already being generated for this project.", {
      runId: activeRun.id,
    });
  }

  const run = await AiGarmentDevelopmentBriefRunRepository.create({
    companyId: actor.companyId,
    projectId,
    referenceAnalysisId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    requestedDirectionCount: input.directionCount,
    designBalance: input.designBalance,
    contextSnapshotJson: contextSnapshot as Prisma.InputJsonValue,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await generateDevelopmentBrief(context);

    const rows = result.directions.map((d) =>
      directionToRow(d, {
        companyId: actor.companyId,
        projectId,
        developmentBriefRunId: run.id,
        createdByUserId: actor.userId,
        aiRawJson: d,
      })
    );
    await AiGarmentDesignDirectionRepository.createMany(rows);
    await AiGarmentDesignDirectionRepository.recomputeRecommendations(projectId);
    await AiGarmentDevelopmentBriefRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_development_brief_runs",
      recordId: run.id,
      action: "CREATE",
      newValues: { directionCount: rows.length, designBalance: input.designBalance },
    });

    return AiGarmentDesignDirectionRepository.findByProjectId(projectId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentDevelopmentBriefRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

export async function listDesignDirections(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return AiGarmentDesignDirectionRepository.findByProjectId(projectId);
}

async function getOwnedDirection(companyId: string, directionId: string) {
  const direction = await AiGarmentDesignDirectionRepository.findWithProjectOwner(directionId);
  if (!direction || direction.project.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design direction not found.", { id: directionId });
  }
  return direction;
}

/**
 * Editing any content field reverts an APPROVED/REJECTED direction back to
 * GENERATED, requiring a fresh decision — the same "material change
 * requires reconsideration" discipline already used for Process 1's
 * analysis approval. Scores/classification are not user-editable directly
 * (only Regenerate produces a new AI assessment) — editing garment
 * features doesn't change the AI's own scoring, only its content.
 */
export async function editDesignDirection(actor: ActorContext, directionId: string, input: EditDesignDirectionInput) {
  const direction = await getOwnedDirection(actor.companyId, directionId);

  const { userNotes, ...contentFields } = input;
  const hasContentEdit = Object.values(contentFields).some((v) => v !== undefined);

  let updated = await AiGarmentDesignDirectionRepository.update(directionId, {
    ...contentFields,
    ...(userNotes !== undefined ? { userNotes: userNotes || null } : {}),
    ...(hasContentEdit ? { userEdited: true, status: "GENERATED" } : {}),
  });

  if (hasContentEdit) {
    // Reverting to GENERATED (from APPROVED/REJECTED) changes which rows are
    // eligible for "top 30%", so re-derive isRecommendedForVisualisation —
    // and re-fetch afterward, since `updated` above still carries whatever
    // that flag was BEFORE this recompute, not after.
    await AiGarmentDesignDirectionRepository.recomputeRecommendations(direction.projectId);
    updated = (await AiGarmentDesignDirectionRepository.findById(directionId))!;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_design_directions",
    recordId: directionId,
    action: "UPDATE",
    newValues: input,
  });

  return updated;
}

export async function decideDesignDirection(actor: ActorContext, directionId: string, input: DesignDirectionDecisionInput) {
  const direction = await getOwnedDirection(actor.companyId, directionId);

  const status = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "SAVED_FOR_LATER";
  await AiGarmentDesignDirectionRepository.update(directionId, { status });

  // A REJECTED direction must never remain marked recommended, and rejecting
  // one changes what "top 30%" means among the rest — recompute either way,
  // then re-fetch: the row returned by update() above still carries whatever
  // isRecommendedForVisualisation was BEFORE this recompute, not after.
  await AiGarmentDesignDirectionRepository.recomputeRecommendations(direction.projectId);
  const updated = (await AiGarmentDesignDirectionRepository.findById(directionId))!;

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_design_directions",
    recordId: directionId,
    action: "UPDATE",
    oldValues: { status: direction.status },
    newValues: { status },
  });

  return updated;
}

/**
 * Branches purely on which FK is set on the direction being regenerated —
 * the same "derive from the real state, never assume" discipline used
 * throughout this codebase. Each branch's own context-build step stays
 * OUTSIDE the try/catch below (a stale-analysis BusinessRuleError should
 * propagate directly, not be reinterpreted as an AI-service error) and only
 * the actual AI call goes inside it — exactly the boundary the original
 * REFERENCE-only version of this function already had, now preserved for
 * both sources rather than narrowed for either.
 */
export async function regenerateDesignDirection(actor: ActorContext, directionId: string) {
  const direction = await getOwnedDirection(actor.companyId, directionId);

  let callAi: () => ReturnType<typeof aiRegenerateDesignDirection>;
  let runFk: { developmentBriefRunId?: string; fabricDevelopmentRunId?: string };

  if (direction.developmentBriefRunId) {
    const run = await AiGarmentDevelopmentBriefRunRepository.findById(direction.developmentBriefRunId);
    if (!run) throw new BusinessRuleError("NOT_FOUND", "The originating development brief run could not be found.");

    const { context } = await buildContext(actor.companyId, direction.projectId, {
      targetMarket: (run.contextSnapshotJson as Record<string, unknown>).targetMarket as string | undefined,
      targetCustomerProfile: (run.contextSnapshotJson as Record<string, unknown>).targetCustomerProfile as string | undefined,
      preferredFabric: (run.contextSnapshotJson as Record<string, unknown>).preferredFabric as string | undefined,
      factoryCapabilities: (run.contextSnapshotJson as Record<string, unknown>).factoryCapabilities as string | undefined,
      targetSellingPrice: (run.contextSnapshotJson as Record<string, unknown>).targetSellingPrice as number | undefined,
      currencyCode: (run.contextSnapshotJson as Record<string, unknown>).currencyCode as string | undefined,
      directionCount: 1,
      designBalance: run.designBalance,
    });
    callAi = () => aiRegenerateDesignDirection(context);
    runFk = { developmentBriefRunId: direction.developmentBriefRunId };
  } else if (direction.fabricDevelopmentRunId) {
    const { context } = await buildFabricContextForRegenerate(actor.companyId, direction.fabricDevelopmentRunId);
    callAi = () => regenerateFabricDesignDirectionAi(context);
    runFk = { fabricDevelopmentRunId: direction.fabricDevelopmentRunId };
  } else {
    // Structurally unreachable given the DB's own exactly-one-source CHECK
    // constraint — kept as a defensive backstop, matching this codebase's
    // own "the DB is the real guarantee, the app-layer check is a clean
    // error message on top of it" convention.
    throw new BusinessRuleError("VALIDATION_ERROR", "This design direction has no originating generation run.");
  }

  try {
    const result = await callAi();
    await AiGarmentDesignDirectionRepository.update(directionId, {
      ...directionToRow(result.direction, {
        companyId: actor.companyId,
        projectId: direction.projectId,
        ...runFk,
        createdByUserId: actor.userId,
        aiRawJson: result.direction,
      }),
      version: { increment: 1 },
      status: "GENERATED",
      aiGeneratedAt: new Date(),
      userEdited: false,
      userNotes: direction.userNotes,
    });

    // The regenerated score may change which rows are eligible for "top 30%" —
    // recompute, then re-fetch: the row returned by update() above still
    // carries whatever isRecommendedForVisualisation was BEFORE this
    // recompute, not after.
    await AiGarmentDesignDirectionRepository.recomputeRecommendations(direction.projectId);
    const updated = (await AiGarmentDesignDirectionRepository.findById(directionId))!;

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_design_directions",
      recordId: directionId,
      action: "UPDATE",
      newValues: { version: direction.version + 1, designDirectionName: result.direction.designDirectionName },
    });

    return updated;
  } catch (err) {
    mapAiError(err);
  }
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateProductSuitability,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/product-suitability/generate";
import type { ProductSuitabilityContext, ProductTypeForSuitability } from "@/core/ai/product-suitability/prompt";
import type { SuitabilityItemOutput } from "@/core/ai/product-suitability/schema";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentFabricAnalysisRepository } from "./fabric-analysis.repository";
import { FABRIC_FEATURE_REGISTRY } from "@/core/ai/fabric-analysis/feature-registry";
import { describeFabricDetail } from "./fabric-detail-description";
import {
  AiGarmentProductSuitabilityRepository,
  AiGarmentProductSuitabilityItemRepository,
  AiGarmentProductSuitabilityRunRepository,
} from "./product-suitability.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Longer than Process 1/7's own single-image window — assessing a
// company's full ProductType list (potentially 20+ items) in one text call
// takes longer, matching the same "longer window for a bigger batch"
// reasoning already used for Process 2's Development Brief run and Process
// 5's Commercial Evaluation run.
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

export async function getProductSuitability(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiGarmentProductSuitabilityRepository.findByProjectId(projectId);
}

export async function runProductSuitability(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  // Real, direct data-dependency check — not just relying on
  // saveWorkflowStep()'s own gate, mirroring Process 2's own
  // buildContext() precedent (checking the Reference Analysis is APPROVED
  // directly inside the service, since it genuinely needs that data).
  const fabricAnalysis = await AiGarmentFabricAnalysisRepository.findByProjectId(projectId);
  if (!fabricAnalysis || fabricAnalysis.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "The Fabric Analysis must be approved before assessing Product Suitability."
    );
  }

  const activeProductTypes = await GarmentAttributeRepository.productType.findMany({
    where: { companyId: actor.companyId, isActive: true },
    orderBy: { name: "asc" },
  });
  if (activeProductTypes.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No active Product Types exist for this company yet. Add at least one in Masters → Garment Attributes → Product Types before assessing suitability."
    );
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentProductSuitabilityRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A suitability assessment is already in progress for this project.", {
      runId: activeRun.id,
    });
  }

  // The requested order is preserved end-to-end: the AI's response is
  // positional (item N corresponds to product type N as listed in the
  // prompt), never id-keyed — same discipline Process 5 already established
  // for its own design comparison.
  const productTypes: ProductTypeForSuitability[] = activeProductTypes.map((pt, index) => ({
    displayNumber: index + 1,
    code: pt.code,
    name: pt.name,
  }));

  const fabricObservations = fabricAnalysis.observations
    .map((o) => {
      const feature = FABRIC_FEATURE_REGISTRY.find((f) => f.key === o.featureKey);
      return feature ? { label: feature.label, value: o.approvedObservation } : null;
    })
    .filter((o): o is { label: string; value: string } => o !== null);

  const context: ProductSuitabilityContext = {
    buyer: project.buyer?.name ?? null,
    customer: project.customer?.name ?? null,
    targetMarket: project.targetMarket ?? null,
    season: project.season?.name ?? null,
    targetSellingPrice: project.targetSellingPrice != null ? Number(project.targetSellingPrice) : null,
    currencyCode: project.currencyCode ?? null,
    fabricSummary: fabricAnalysis.fabricSummary ?? "",
    fabricObservations,
    fabricDescription: describeFabricDetail(project.fabricDetail),
    productTypes,
  };

  const existingSuitability = await AiGarmentProductSuitabilityRepository.findByProjectId(projectId);
  const nextVersion = (existingSuitability?.analysisVersion ?? 0) + 1;

  const run = await AiGarmentProductSuitabilityRunRepository.create({
    companyId: actor.companyId,
    projectId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    analysisVersion: nextVersion,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await generateProductSuitability(context);

    const itemRows = result.items.map((item: SuitabilityItemOutput, index: number) => ({
      productTypeId: activeProductTypes[index].id,
      aiRating: item.rating,
      aiReasoning: item.reasoning,
      approvedRating: item.rating,
    }));

    const suitability = await AiGarmentProductSuitabilityRepository.replaceForProject(
      projectId,
      {
        companyId: actor.companyId,
        projectId,
        status: "AI_ANALYSED",
        analysisVersion: nextVersion,
        promptVersion: PROMPT_VERSION,
        provider: "anthropic",
        model: result.model,
        rawResponseJson: result.rawResponse as object,
        overallSummary: result.overallSummary,
        createdByUserId: actor.userId,
      },
      itemRows
    );

    await AiGarmentProductSuitabilityRunRepository.markSuccess(run.id, suitability.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_product_suitabilities",
      recordId: suitability.id,
      action: "CREATE",
      newValues: { analysisVersion: suitability.analysisVersion, model: suitability.model, productTypeCount: productTypes.length },
    });

    return await AiGarmentProductSuitabilityRepository.findByProjectId(projectId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentProductSuitabilityRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/**
 * Editing (or resetting) any item's rating on an APPROVED assessment pushes
 * it back to UNDER_REVIEW, requiring a fresh Approve — same discipline as
 * Fabric/Reference Analysis's own bumpAnalysisStatusForEdit, applied
 * uniformly rather than trying to classify which edits are "material."
 */
async function bumpSuitabilityStatusForEdit(suitabilityId: string, currentStatus: string) {
  if (currentStatus === "STALE") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This assessment is out of date — run a fresh assessment before editing items.",
      { status: currentStatus }
    );
  }
  if (currentStatus !== "UNDER_REVIEW") {
    await AiGarmentProductSuitabilityRepository.updateStatus(suitabilityId, "UNDER_REVIEW");
  }
}

export async function updateSuitabilityItem(actor: ActorContext, itemId: string, approvedRating: string) {
  const item = await AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner(itemId);
  if (!item || item.suitability.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Suitability item not found.", { id: itemId });
  }

  await bumpSuitabilityStatusForEdit(item.suitabilityId, item.suitability.status);

  const updated = await AiGarmentProductSuitabilityItemRepository.update(itemId, {
    approvedRating: approvedRating as never,
    userEdited: true,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_product_suitability_items",
    recordId: itemId,
    action: "UPDATE",
    oldValues: { approvedRating: item.approvedRating, userEdited: item.userEdited },
    newValues: { approvedRating, userEdited: true },
  });

  return updated;
}

export async function resetSuitabilityItemToAi(actor: ActorContext, itemId: string) {
  const item = await AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner(itemId);
  if (!item || item.suitability.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Suitability item not found.", { id: itemId });
  }

  await bumpSuitabilityStatusForEdit(item.suitabilityId, item.suitability.status);

  const updated = await AiGarmentProductSuitabilityItemRepository.update(itemId, {
    approvedRating: item.aiRating,
    userEdited: false,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_product_suitability_items",
    recordId: itemId,
    action: "UPDATE",
    oldValues: { approvedRating: item.approvedRating, userEdited: item.userEdited },
    newValues: { approvedRating: item.aiRating, userEdited: false },
  });

  return updated;
}

export async function approveProductSuitability(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const suitability = await AiGarmentProductSuitabilityRepository.findByProjectId(project.id);
  if (!suitability) {
    throw new BusinessRuleError("NOT_FOUND", "No suitability assessment exists for this project yet.");
  }
  if (!["AI_ANALYSED", "UNDER_REVIEW"].includes(suitability.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      suitability.status === "STALE"
        ? "This assessment is out of date — run a fresh assessment before approving."
        : `Cannot approve an assessment in "${suitability.status}" status.`,
      { status: suitability.status }
    );
  }

  const approved = await AiGarmentProductSuitabilityRepository.approveWithItems(suitability.id, actor.userId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_product_suitabilities",
    recordId: suitability.id,
    action: "APPROVE",
    oldValues: { status: suitability.status },
    newValues: { status: "APPROVED", approvedByUserId: actor.userId },
  });

  return approved;
}

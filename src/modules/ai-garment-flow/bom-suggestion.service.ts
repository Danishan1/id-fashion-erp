import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  generateBomSuggestions as callBomSuggestionAi,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/bom-suggestion/generate";
import type { BomSuggestionContext } from "@/core/ai/bom-suggestion/prompt";
import { getBomByProductId, upsertBom } from "@/modules/bom-mrp/bom.service";
import type { BomItemInput } from "@/modules/bom-mrp/bom.schema";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { describeFabricDetail } from "./fabric-detail-description";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { saveWorkflowStep } from "./ai-garment-project.service";
import { AiGarmentBomSuggestionRunRepository, AiGarmentBomSuggestionRepository } from "./bom-suggestion.repository";
import type { GenerateBomSuggestionsInput, ResolveBomSuggestionInput } from "./bom-suggestion.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 2/5/6/7 use for their own larger/slower AI calls — a
// full draft-BOM suggestion is a comparably-sized structured-text response.
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
 * "Generate Draft BOM" — needs the project's selected design direction (for
 * its own structured construction/fabric fields) and does NOT require
 * productId to already be set, since suggesting materials is useful before
 * a Style formally exists too; resolving a suggestion into a real BomItem
 * (below) is the action that actually requires the graduated Style, since
 * that's what bom-mrp's own Bom/BomItem schema is keyed on.
 */
export async function generateBomSuggestions(actor: ActorContext, projectId: string, input: GenerateBomSuggestionsInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.selectedDesignDirectionId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Select a design for development first (Commercial Evaluation step) before generating a draft BOM."
    );
  }

  const direction = await AiGarmentDesignDirectionRepository.findById(project.selectedDesignDirectionId);
  if (!direction) throw new BusinessRuleError("NOT_FOUND", "Selected design direction not found.", { id: project.selectedDesignDirectionId });

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentBomSuggestionRunRepository.findActiveSince(direction.id, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A draft BOM is already being generated for this design.", {
      runId: activeRun.id,
    });
  }

  const context: BomSuggestionContext = {
    designDirectionName: direction.designDirectionName,
    silhouette: direction.silhouette,
    garmentLength: direction.garmentLength,
    fit: direction.fit,
    neckline: direction.neckline,
    collar: direction.collar,
    sleeve: direction.sleeve,
    closure: direction.closure,
    pocket: direction.pocket,
    waistTreatment: direction.waistTreatment,
    hem: direction.hem,
    keyNewDesignFeature: direction.keyNewDesignFeature,
    suggestedFabricCharacter: direction.suggestedFabricCharacter,
    suggestedTrims: direction.suggestedTrims,
    fabricDescription: describeFabricDetail(project.fabricDetail),
    targetMarket: project.targetMarket,
    season: project.season?.name ?? null,
    additionalGuidance: input.additionalGuidance,
  };

  const run = await AiGarmentBomSuggestionRunRepository.create({
    companyId: actor.companyId,
    projectId,
    designDirectionId: direction.id,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    promptText: JSON.stringify(context),
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await callBomSuggestionAi(context);

    await AiGarmentBomSuggestionRepository.createMany(
      result.items.map((item) => ({
        companyId: actor.companyId,
        projectId,
        designDirectionId: direction.id,
        runId: run.id,
        materialDescription: item.materialDescription,
        materialCategory: item.materialCategory,
        suggestedQuantityPerUnit: item.suggestedQuantityPerUnit,
        suggestedUom: item.suggestedUom,
        suggestedWastagePercentage: item.suggestedWastagePercentage,
        colorNote: item.colorNote || null,
        reasoning: item.reasoning,
      }))
    );

    await AiGarmentBomSuggestionRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_bom_suggestions",
      recordId: run.id,
      action: "CREATE",
      newValues: { designDirectionId: direction.id, suggestionCount: result.items.length },
    });

    return AiGarmentBomSuggestionRepository.findByDesignDirectionId(direction.id);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentBomSuggestionRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/** Empty (not an error) when no design has been selected yet, matching every other AI Garment Flow list endpoint's own empty state. */
export async function listBomSuggestions(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.selectedDesignDirectionId) return [];
  return AiGarmentBomSuggestionRepository.findByDesignDirectionId(project.selectedDesignDirectionId);
}

/**
 * Resolves one AI suggestion into a real BomItem — never writes to
 * AiGarmentBomSuggestion's own advisory fields, and never invents a second
 * BOM-writing mechanism: reads the graduated Style's current real BOM (if
 * any already exists), appends this one user-confirmed line (every value
 * editable, never blindly trusted from the AI's own suggestion), and calls
 * the existing, unchanged upsertBom() with the merged item list — the same
 * "reuse an existing module's real write path, orchestrate the merge around
 * it" shape already used by Material Request's own
 * generatePurchaseOrdersForShortfall() calling createPurchaseOrder().
 * Explicitly asserts bom_mrp/edit — the permission this action actually
 * needs, not just the ai_garment_flow one the route sits under, matching
 * that same Material Request precedent.
 */
export async function resolveBomSuggestion(actor: ActorContext, suggestionId: string, input: ResolveBomSuggestionInput) {
  const suggestion = await AiGarmentBomSuggestionRepository.findWithProjectOwner(suggestionId);
  if (!suggestion || suggestion.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "BOM suggestion not found.", { id: suggestionId });
  }
  if (suggestion.decision !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This suggestion is already ${suggestion.decision.toLowerCase()}.`);
  }

  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, suggestion.projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: suggestion.projectId });
  if (!project.productId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Convert this project to a Style first (Technical Development step).");
  }

  await PermissionService.assert(actor.userId, "bom_mrp", "edit");

  const { bom } = await getBomByProductId(actor.companyId, project.productId);
  const currentVersion = bom?.versions.find((v) => v.versionNumber === bom.currentVersionNumber);
  const existingItems: BomItemInput[] = (currentVersion?.items ?? []).map((item) => ({
    materialId: item.material.id,
    colorId: item.color?.id ?? "",
    quantityPerUnit: Number(item.quantityPerUnit),
    wastagePercentage: Number(item.wastagePercentage),
    uomId: item.uom.id,
    notes: item.notes ?? "",
  }));

  const updatedBom = await upsertBom(actor, project.productId, {
    notes: currentVersion?.notes || "",
    items: [...existingItems, input],
  });

  const newVersion = updatedBom.versions.find((v) => v.versionNumber === updatedBom.currentVersionNumber)!;
  const newItem = newVersion.items.find((item) => item.material.id === input.materialId && (item.color?.id ?? "") === (input.colorId ?? ""));
  if (!newItem) {
    // Should be structurally impossible (upsertBom's own duplicate/overlap guard already rejects
    // a colliding materialId+colorId pair before this point) — a defensive backstop, not an
    // expected path.
    throw new BusinessRuleError("VALIDATION_ERROR", "The new BOM line could not be located after saving.");
  }

  const updated = await AiGarmentBomSuggestionRepository.markAdded(suggestionId, newItem.id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_bom_suggestions",
    recordId: suggestionId,
    action: "UPDATE",
    oldValues: { decision: "PENDING" },
    newValues: { decision: "ADDED", resolvedBomItemId: newItem.id },
  });

  return updated;
}

/** "Dismiss" — the user decided not to use this suggestion. Never writes to the real BOM. */
export async function dismissBomSuggestion(actor: ActorContext, suggestionId: string) {
  const suggestion = await AiGarmentBomSuggestionRepository.findWithProjectOwner(suggestionId);
  if (!suggestion || suggestion.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "BOM suggestion not found.", { id: suggestionId });
  }
  if (suggestion.decision !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This suggestion is already ${suggestion.decision.toLowerCase()}.`);
  }

  const updated = await AiGarmentBomSuggestionRepository.markDismissed(suggestionId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_bom_suggestions",
    recordId: suggestionId,
    action: "UPDATE",
    oldValues: { decision: "PENDING" },
    newValues: { decision: "DISMISSED" },
  });

  return updated;
}

/**
 * "Continue to Costing" — no new persisted decision on the project itself
 * (unlike Processes 5/6/7's own "approved X" fields): whether the BOM is
 * ready to move past is already a real, existing fact this module derives
 * rather than duplicates — bom-mrp's own `Bom.approvedVersionId`, the exact
 * gate MRP/Production already consume. Reuses the existing, unchanged
 * saveWorkflowStep() twice, the same pattern Processes 5/6/7 established.
 */
export async function completeBomStep(actor: ActorContext, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.productId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Convert this project to a Style first (Technical Development step).");
  }

  const { bom } = await getBomByProductId(actor.companyId, project.productId);
  if (!bom || !bom.approvedVersionId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approve this style's BOM in the BOM editor before continuing to Costing.");
  }

  await saveWorkflowStep(actor, projectId, { stepKey: "BOM" });

  const steps = stepsForSourceType(project.sourceType);
  const currentIndex = steps.findIndex((s) => s.key === "BOM");
  const nextStep = steps[currentIndex + 1];
  if (nextStep) {
    await saveWorkflowStep(actor, projectId, { stepKey: nextStep.key });
  }

  return project;
}

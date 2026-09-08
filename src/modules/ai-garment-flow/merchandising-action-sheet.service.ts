import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getBomByProductId } from "@/modules/bom-mrp/bom.service";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { getProductionStatusForProject } from "./ai-garment-project.service";
import { AiGarmentReferenceAnalysisRepository } from "./reference-analysis.repository";
import { AiGarmentFabricAnalysisRepository } from "./fabric-analysis.repository";
import { AiGarmentProductSuitabilityRepository } from "./product-suitability.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { AiGarmentGeneratedImageRepository } from "./visual-generation.repository";
import { AiGarmentDesignVariationRepository } from "./design-variation.repository";
import { AiGarmentCommercialEvaluationRepository } from "./commercial-evaluation.repository";
import { AiGarmentFabricApplicationRepository } from "./fabric-application.repository";
import { AiGarmentTechnicalFlatRepository } from "./technical-development.repository";
import { AiGarmentTechnicalSpecificationRepository } from "./technical-specification.repository";
import { AiGarmentBomSuggestionRepository } from "./bom-suggestion.repository";
import { AiGarmentCostAnalysisRepository } from "./cost-analysis.repository";
import { AiGarmentValueEngineeringRepository } from "./value-engineering.repository";
import { AiGarmentBuyerCommentsRepository } from "./buyer-comments.repository";

async function getOwnedProject(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return project;
}

/**
 * "MERCHANDISING ACTION SHEET" (the user's own process 17, the last item on
 * their 17-item list) — a PURE READ-ONLY ROLLUP of a project's real status
 * across every one of the other 16 processes. Deliberately makes zero AI
 * calls and proposes zero AI-generated action items — every field here is
 * either read directly off an existing table or derived by a plain,
 * reviewable rule (e.g. "this step isn't in completedStepKeys yet"), per the
 * user's own explicit scoping ("pure aggregation for now, no AI-proposed
 * action items"). Fans out across every sibling module's own already-built
 * findByProjectId/findLatestByProjectId/findByDesignDirectionId query
 * instead of duplicating any of their logic.
 */
export async function getMerchandisingActionSheet(companyId: string, projectId: string) {
  const project = await getOwnedProject(companyId, projectId);
  const steps = stepsForSourceType(project.sourceType);

  const [
    referenceAnalysis,
    fabricAnalysis,
    productSuitability,
    designDirections,
    commercialEvaluation,
    costAnalysis,
    valueEngineering,
    buyerComments,
  ] = await Promise.all([
    project.sourceType === "REFERENCE" ? AiGarmentReferenceAnalysisRepository.findByProjectId(project.id) : null,
    project.sourceType === "FABRIC" ? AiGarmentFabricAnalysisRepository.findByProjectId(project.id) : null,
    project.sourceType === "FABRIC" ? AiGarmentProductSuitabilityRepository.findByProjectId(project.id) : null,
    AiGarmentDesignDirectionRepository.findByProjectId(project.id),
    AiGarmentCommercialEvaluationRepository.findLatestByProjectId(project.id),
    AiGarmentCostAnalysisRepository.findLatestByProjectId(project.id),
    AiGarmentValueEngineeringRepository.findLatestByProjectId(project.id),
    AiGarmentBuyerCommentsRepository.findLatestByProjectId(project.id),
  ]);

  const selectedDirectionId = project.selectedDesignDirectionId;
  const selectedDirection = selectedDirectionId ? designDirections.find((d) => d.id === selectedDirectionId) ?? null : null;

  const [generatedImages, designVariations, fabricApplications, technicalFlats, technicalSpecifications, bomSuggestions] = selectedDirectionId
    ? await Promise.all([
        AiGarmentGeneratedImageRepository.findByDesignDirectionId(selectedDirectionId),
        AiGarmentDesignVariationRepository.findByDesignDirectionId(selectedDirectionId),
        AiGarmentFabricApplicationRepository.findByDesignDirectionId(selectedDirectionId),
        AiGarmentTechnicalFlatRepository.findByDesignDirectionId(selectedDirectionId),
        AiGarmentTechnicalSpecificationRepository.findByDesignDirectionId(selectedDirectionId),
        AiGarmentBomSuggestionRepository.findByDesignDirectionId(selectedDirectionId),
      ])
    : [[], [], [], [], [], []];

  const bomInfo = project.productId ? await getBomByProductId(companyId, project.productId) : null;
  const productionStatus = await getProductionStatusForProject(companyId, project.id);

  const approvedDirections = designDirections.filter((d) => d.status === "APPROVED");

  const pendingActions: string[] = [];
  if (project.status === "COMPLETED") {
    pendingActions.push("Project complete — no further action needed.");
  } else if (project.status === "REJECTED" || project.status === "CANCELLED") {
    pendingActions.push(`Project ${project.status.toLowerCase()} — no further action expected.`);
  } else {
    if (project.sourceType === "REFERENCE") {
      if (!referenceAnalysis) pendingActions.push("Upload a reference image and run Reference Analysis.");
      else if (referenceAnalysis.status !== "APPROVED") pendingActions.push(`Review and approve Reference Analysis (currently ${referenceAnalysis.status}).`);
    } else {
      if (!fabricAnalysis) pendingActions.push("Upload a fabric swatch and run Fabric Analysis.");
      else if (fabricAnalysis.status !== "APPROVED") pendingActions.push(`Review and approve Fabric Analysis (currently ${fabricAnalysis.status}).`);
      else if (!productSuitability) pendingActions.push("Run the Product/Fabric Suitability assessment.");
      else if (productSuitability.status !== "APPROVED") pendingActions.push(`Review and approve Product/Fabric Suitability (currently ${productSuitability.status}).`);
    }

    if (designDirections.length === 0) pendingActions.push("Generate design directions.");
    else if (approvedDirections.length === 0) pendingActions.push("Approve at least one design direction.");

    if (!selectedDirectionId && approvedDirections.length > 0) {
      pendingActions.push("Compare designs commercially and select one for development.");
    }

    if (selectedDirectionId) {
      if (project.sourceType === "REFERENCE" && !project.approvedFabricApplicationId) {
        pendingActions.push("Approve a fabric application onto the selected design.");
      }
      if (!project.approvedTechnicalFlatId) pendingActions.push("Approve a Technical Flat for the selected design.");
      if (!project.approvedTechnicalSpecificationId) pendingActions.push("Approve a Technical Specification (measurement chart) for the selected design.");

      if (!project.productId) {
        pendingActions.push("Convert the project to a Style to begin BOM/Costing.");
      } else {
        if (!bomInfo?.bom?.approvedVersionId) pendingActions.push("Author and approve a BOM for the graduated Style.");
        if (!project.sampleRequestId) pendingActions.push("Create a Sample Request to begin Costing.");
      }
    }

    if (project.sampleRequestId && project.sampleRequest) {
      const terminal = ["APPROVED", "REJECTED", "CANCELLED"];
      if (!terminal.includes(project.sampleRequest.status)) {
        pendingActions.push(`Awaiting buyer decision on the linked Sample Request (currently ${project.sampleRequest.status}).`);
      }
    }

    if (project.completedStepKeys.includes("SAMPLING_REVIEW")) {
      if (!project.salesOrderId) pendingActions.push("Link a Sales Order to the project.");
      else if (!productionStatus.hasProductionOrder) pendingActions.push("Create a Production Order against the linked Sales Order.");
      else pendingActions.push("Mark the project workflow complete.");
    }
  }

  return {
    project: {
      id: project.id,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      sourceType: project.sourceType,
      status: project.status,
      currentStepKey: project.currentStepKey,
      customerName: project.customer?.name ?? null,
      buyerName: project.buyer?.name ?? null,
      brandName: project.brand?.name ?? null,
      seasonName: project.season?.name ?? null,
      categoryName: project.category?.name ?? null,
      targetMarket: project.targetMarket,
      targetCustomerProfile: project.targetCustomerProfile,
      targetSellingPrice: project.targetSellingPrice,
      currencyCode: project.currencyCode,
      orderQuantityEstimate: project.orderQuantityEstimate,
      styleCode: project.product?.styleCode ?? null,
      styleName: project.product?.styleName ?? null,
    },
    workflowProgress: steps.map((s) => ({
      key: s.key,
      label: s.label,
      completed: project.completedStepKeys.includes(s.key),
      isCurrent: project.currentStepKey === s.key,
    })),
    designDevelopment: {
      referenceAnalysisStatus: referenceAnalysis?.status ?? null,
      fabricAnalysisStatus: fabricAnalysis?.status ?? null,
      productSuitability: productSuitability
        ? {
            status: productSuitability.status,
            highlySuitableCount: productSuitability.items.filter((i) => i.approvedRating === "HIGHLY_SUITABLE").length,
            suitableCount: productSuitability.items.filter((i) => i.approvedRating === "SUITABLE").length,
          }
        : null,
      designDirections: {
        total: designDirections.length,
        approved: approvedDirections.length,
        recommended: designDirections.filter((d) => d.isRecommendedForVisualisation).length,
        selected: selectedDirection
          ? {
              id: selectedDirection.id,
              name: selectedDirection.designDirectionName,
              overallScore: selectedDirection.overallScore,
              classification: selectedDirection.commercialClassification,
            }
          : null,
      },
      generatedImages: { total: generatedImages.length, selectedCount: generatedImages.filter((i) => i.decision === "SELECTED").length },
      designVariations: { total: designVariations.length },
      commercialEvaluation: commercialEvaluation
        ? { evaluatedAt: commercialEvaluation.createdAt, itemCount: commercialEvaluation.items.length }
        : null,
    },
    fabricAndTechnical: {
      fabricApplication:
        project.sourceType === "REFERENCE"
          ? { attempts: fabricApplications.length, approved: !!project.approvedFabricApplicationId }
          : null,
      technicalFlat: { attempts: technicalFlats.length, approved: !!project.approvedTechnicalFlatId },
      technicalSpecification: { attempts: technicalSpecifications.length, approved: !!project.approvedTechnicalSpecificationId },
    },
    costingAndBom: {
      bomApproved: !!bomInfo?.bom?.approvedVersionId,
      bomItemCount: bomInfo?.bom?.approvedVersion?.items.length ?? null,
      bomSuggestions: {
        total: bomSuggestions.length,
        added: bomSuggestions.filter((s) => s.decision === "ADDED").length,
        dismissed: bomSuggestions.filter((s) => s.decision === "DISMISSED").length,
        pending: bomSuggestions.filter((s) => s.decision === "PENDING").length,
      },
      costAnalysis: costAnalysis
        ? { generatedAt: costAnalysis.createdAt, estimatedCostPerUnitLow: costAnalysis.estimatedCostPerUnitLow, estimatedCostPerUnitHigh: costAnalysis.estimatedCostPerUnitHigh }
        : null,
      valueEngineering: valueEngineering ? { generatedAt: valueEngineering.createdAt, suggestionCount: valueEngineering.suggestions.length } : null,
    },
    buyerFeedback: buyerComments
      ? { generatedAt: buyerComments.createdAt, overallSummary: buyerComments.overallSummary, categories: buyerComments.categories }
      : null,
    samplingAndProduction: {
      sampleRequest: project.sampleRequest ? { requestNumber: project.sampleRequest.requestNumber, status: project.sampleRequest.status } : null,
      salesOrder: project.salesOrder ? { orderNumber: project.salesOrder.orderNumber, status: project.salesOrder.status } : null,
      hasProductionOrder: productionStatus.hasProductionOrder,
    },
    pendingActions,
  };
}

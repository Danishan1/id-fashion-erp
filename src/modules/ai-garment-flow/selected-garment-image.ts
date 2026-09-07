import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentGeneratedImageRepository } from "./visual-generation.repository";
import { AiGarmentDesignVariationRepository } from "./design-variation.repository";

/**
 * "Start from the SELECTED DESIGN" — resolves the specific garment image a
 * later process should act on. Checks every image AND every variation across
 * the selected design direction for whichever was most recently marked
 * SELECTED (a variation can supersede its own parent image as "the chosen
 * visual," so both pools are checked rather than assuming one always wins),
 * never guessing which one to use when the signal is ambiguous or absent.
 *
 * Extracted out of Process 6's fabric-application.service.ts so Process 7
 * (Technical Development) can reuse the identical resolution logic rather
 * than re-deriving it — both processes need "whichever garment visual is
 * currently the chosen one" as their own starting point.
 */
export async function resolveSelectedGarmentImage(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.selectedDesignDirectionId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Select a design for development first (Commercial Evaluation step) before continuing."
    );
  }

  const [images, variations] = await Promise.all([
    AiGarmentGeneratedImageRepository.findByDesignDirectionId(project.selectedDesignDirectionId),
    AiGarmentDesignVariationRepository.findByDesignDirectionId(project.selectedDesignDirectionId),
  ]);

  const candidates = [
    ...images.filter((i) => i.decision === "SELECTED").map((i) => ({ imageAttachmentId: i.imageAttachmentId, at: i.updatedAt })),
    ...variations.filter((v) => v.decision === "SELECTED").map((v) => ({ imageAttachmentId: v.imageAttachmentId, at: v.updatedAt })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  if (candidates.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No visual has been selected for this design yet — select one on the Generate Variations step first."
    );
  }

  return { project, designDirectionId: project.selectedDesignDirectionId, baseImageAttachmentId: candidates[0].imageAttachmentId };
}

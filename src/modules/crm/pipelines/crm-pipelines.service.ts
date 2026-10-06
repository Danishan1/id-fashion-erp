import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { DEFAULT_PIPELINE } from "../opportunities/opportunity-registry";
import { CrmPipelineRepository } from "./crm-pipeline.repository";

/**
 * Phase 06 — the minimum pipeline/stage surface opportunities consume: a
 * default "Sales" pipeline created lazily, read access for pickers and
 * validation. Pipeline management (CRUD, ordering, probabilities, rules,
 * board) is Phase 07 and extends this module.
 */

export async function ensureDefaultPipeline(companyId: string) {
  if ((await CrmPipelineRepository.count(companyId)) > 0) return;
  try {
    await CrmPipelineRepository.createWithStages(
      companyId,
      { key: DEFAULT_PIPELINE.key, name: DEFAULT_PIPELINE.name, isDefault: true, sortOrder: 10 },
      DEFAULT_PIPELINE.stages.map((s) => ({ ...s }))
    );
  } catch (e) {
    // Two first uses at the same time: the other request created it (unique company+key).
    if ((e as { code?: string }).code !== "P2002") throw e;
  }
}

export async function listPipelines(companyId: string) {
  await ensureDefaultPipeline(companyId);
  return CrmPipelineRepository.list(companyId);
}
export type PipelineWithStages = Awaited<ReturnType<typeof listPipelines>>[number];

/** Default pipeline + its first active stage (new opportunities start there). */
export async function getDefaultPipelineStage(companyId: string) {
  await ensureDefaultPipeline(companyId);
  const pipeline = await CrmPipelineRepository.findDefault(companyId);
  if (!pipeline) return null;
  const stage = await CrmPipelineRepository.firstActiveStage(companyId, pipeline.id);
  return stage ? { pipeline, stage } : null;
}

/**
 * Validates a pipeline/stage pair for an opportunity: both in the company,
 * the stage belongs to the pipeline and is active (an inactive stage can be
 * kept but not newly chosen).
 */
export async function resolvePipelineStage(companyId: string, input: { pipelineId?: string | null; stageId: string }, currentStageId?: string | null) {
  const stage = await CrmPipelineRepository.findStage(companyId, input.stageId);
  if (!stage) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a valid stage.", { fieldErrors: { stageId: "Choose a valid stage." } });
  if (input.pipelineId && input.pipelineId !== stage.pipelineId) throw new BusinessRuleError("VALIDATION_ERROR", "That stage belongs to a different pipeline.", { fieldErrors: { stageId: "Choose a stage of the selected pipeline." } });
  const pipeline = await CrmPipelineRepository.findPipeline(companyId, stage.pipelineId);
  if (!pipeline) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a valid pipeline.", { fieldErrors: { pipelineId: "Choose a valid pipeline." } });
  if (stage.id !== currentStageId && (!stage.isActive || !pipeline.isActive)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${stage.name}" is no longer in use.`, { fieldErrors: { stageId: "Choose an active stage." } });
  }
  return { pipeline, stage };
}

export function getStage(companyId: string, stageId: string) {
  return CrmPipelineRepository.findStage(companyId, stageId);
}

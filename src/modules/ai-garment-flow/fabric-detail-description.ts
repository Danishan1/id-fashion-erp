import { AiGarmentProjectRepository } from "./ai-garment-project.repository";

type ProjectWithDetails = NonNullable<Awaited<ReturnType<typeof AiGarmentProjectRepository.findByIdWithDetails>>>;

/**
 * "Fabric if known" per the Commercial Evaluation spec — only meaningful
 * when `AiGarmentFabricDetail` already exists for this project (Apply
 * Fabric hasn't necessarily happened yet at some points in the workflow, so
 * this is commonly absent, which is fine — callers simply omit the field
 * from their own prompt when this returns null).
 *
 * Extracted out of Process 5's commercial-evaluation.service.ts so Process 8
 * (BOM Suggestion) can reuse the identical formatting rather than
 * re-deriving it a second time.
 */
export function describeFabricDetail(fabricDetail: ProjectWithDetails["fabricDetail"]): string | null {
  if (!fabricDetail) return null;
  const parts: string[] = [];
  if (fabricDetail.gsm) parts.push(`${fabricDetail.gsm.name} GSM`);
  if (fabricDetail.composition) parts.push(fabricDetail.composition.name);
  if (fabricDetail.weaveType) parts.push(fabricDetail.weaveType.name);
  if (fabricDetail.width) parts.push(`${fabricDetail.width.name} width`);
  if (fabricDetail.dye) parts.push(fabricDetail.dye.pantone ? `${fabricDetail.dye.name} (${fabricDetail.dye.pantone})` : fabricDetail.dye.name);
  if (fabricDetail.color) parts.push(fabricDetail.color.name);
  return parts.length > 0 ? parts.join(", ") : null;
}

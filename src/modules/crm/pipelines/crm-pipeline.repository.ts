import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const STAGE_SELECT = { id: true, pipelineId: true, key: true, name: true, probability: true, isActive: true, sortOrder: true } as const;

/** Pipelines / stages data access (read + default creation only until Phase 07). */
export const CrmPipelineRepository = {
  count(companyId: string) {
    return prisma.crmPipeline.count({ where: { companyId } });
  },
  /** Creates a pipeline and its stages; a concurrent first use is tolerated via the unique key. */
  async createWithStages(companyId: string, pipeline: { key: string; name: string; isDefault: boolean; sortOrder: number }, stages: { key: string; name: string; probability: number | null }[]) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.crmPipeline.findFirst({ where: { companyId, key: pipeline.key } });
      if (existing) return;
      const p = await tx.crmPipeline.create({ data: { companyId, ...pipeline } });
      await tx.crmPipelineStage.createMany({ data: stages.map((s, i) => ({ companyId, pipelineId: p.id, key: s.key, name: s.name, probability: s.probability, sortOrder: (i + 1) * 10 })) });
    });
  },
  list(companyId: string) {
    return prisma.crmPipeline.findMany({
      where: { companyId },
      select: { id: true, key: true, name: true, isDefault: true, isActive: true, sortOrder: true, stages: { select: STAGE_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },
  findPipeline(companyId: string, id: string) {
    return prisma.crmPipeline.findFirst({ where: { id, companyId }, select: { id: true, key: true, name: true, isDefault: true, isActive: true } });
  },
  findDefault(companyId: string) {
    return prisma.crmPipeline.findFirst({ where: { companyId, isActive: true }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }], select: { id: true, key: true, name: true, isDefault: true, isActive: true } });
  },
  findStage(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmPipelineStage.findFirst({ where: { id, companyId }, select: STAGE_SELECT });
  },
  firstActiveStage(companyId: string, pipelineId: string) {
    return prisma.crmPipelineStage.findFirst({ where: { companyId, pipelineId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: STAGE_SELECT });
  },
  stagesById(companyId: string, ids: string[]) {
    return prisma.crmPipelineStage.findMany({ where: { companyId, id: { in: ids } }, select: STAGE_SELECT });
  },
};
export type CrmStageRow = NonNullable<Awaited<ReturnType<typeof CrmPipelineRepository.findStage>>>;

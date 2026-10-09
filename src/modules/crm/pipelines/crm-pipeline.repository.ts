import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

export const STAGE_SELECT = {
  id: true,
  pipelineId: true,
  key: true,
  name: true,
  description: true,
  probability: true,
  isDefault: true,
  isActive: true,
  sortOrder: true,
  requiredFields: true,
  transitionMode: true,
  archivedAt: true,
  version: true,
} as const;

export const PIPELINE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  isDefault: true,
  isActive: true,
  sortOrder: true,
  archivedAt: true,
  version: true,
} as const;

const STAGE_ORDER: Prisma.CrmPipelineStageOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { createdAt: "asc" }];
const PIPELINE_ORDER: Prisma.CrmPipelineOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { createdAt: "asc" }];

const RULE_SELECT = { id: true, fromStageId: true, toStageId: true, allowed: true, requiredFields: true, message: true } as const;

/** Pipelines / stages / transition rules data access (Phase 06 read surface, extended in Phase 07). */
export const CrmPipelineRepository = {
  count(companyId: string) {
    return prisma.crmPipeline.count({ where: { companyId } });
  },
  /** Creates a pipeline and its stages; a concurrent first use is tolerated via the unique key. */
  async createWithStages(companyId: string, pipeline: { key: string; name: string; isDefault: boolean; sortOrder: number }, stages: { key: string; name: string; probability: number | null }[]) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.crmPipeline.findFirst({ where: { companyId, key: pipeline.key } });
      if (existing) return;
      const p = await tx.crmPipeline.create({ data: { companyId, ...pipeline, nameKey: pipeline.name.trim().toLowerCase() } });
      await tx.crmPipelineStage.createMany({
        data: stages.map((s, i) => ({ companyId, pipelineId: p.id, key: s.key, name: s.name, nameKey: s.name.trim().toLowerCase(), probability: s.probability, sortOrder: (i + 1) * 10, isDefault: i === 0 })),
      });
    });
  },
  list(companyId: string, { includeArchived = true } = {}) {
    return prisma.crmPipeline.findMany({
      where: { companyId, ...(includeArchived ? {} : { archivedAt: null }) },
      select: { ...PIPELINE_SELECT, stages: { select: STAGE_SELECT, orderBy: STAGE_ORDER } },
      orderBy: PIPELINE_ORDER,
    });
  },
  findPipeline(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmPipeline.findFirst({ where: { id, companyId }, select: PIPELINE_SELECT });
  },
  findPipelineWithStages(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmPipeline.findFirst({ where: { id, companyId }, select: { ...PIPELINE_SELECT, stages: { select: STAGE_SELECT, orderBy: STAGE_ORDER } } });
  },
  findPipelineByName(companyId: string, nameKey: string, excludeId?: string) {
    return prisma.crmPipeline.findFirst({ where: { companyId, nameKey, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true } });
  },
  keyExists(companyId: string, key: string) {
    return prisma.crmPipeline.findFirst({ where: { companyId, key }, select: { id: true } }).then(Boolean);
  },
  maxPipelineSortOrder(companyId: string) {
    return prisma.crmPipeline.aggregate({ where: { companyId }, _max: { sortOrder: true } }).then((r) => r._max.sortOrder ?? 0);
  },
  /** The company's default pipeline (falls back to the first active one). */
  findDefault(companyId: string, db: CrmDb = prisma) {
    return db.crmPipeline.findFirst({ where: { companyId, archivedAt: null }, orderBy: [{ isDefault: "desc" }, ...PIPELINE_ORDER], select: PIPELINE_SELECT });
  },
  findStage(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmPipelineStage.findFirst({ where: { id, companyId }, select: STAGE_SELECT });
  },
  /** The pipeline's default stage, else its first active stage. */
  defaultStage(companyId: string, pipelineId: string, db: CrmDb = prisma) {
    return db.crmPipelineStage.findFirst({ where: { companyId, pipelineId, archivedAt: null }, orderBy: [{ isDefault: "desc" }, ...STAGE_ORDER], select: STAGE_SELECT });
  },
  /** Phase 06 name, kept for callers: now the default stage. */
  firstActiveStage(companyId: string, pipelineId: string) {
    return CrmPipelineRepository.defaultStage(companyId, pipelineId);
  },
  stagesById(companyId: string, ids: string[], db: CrmDb = prisma) {
    return db.crmPipelineStage.findMany({ where: { companyId, id: { in: ids } }, select: STAGE_SELECT });
  },
  stagesOf(companyId: string, pipelineId: string, db: CrmDb = prisma) {
    return db.crmPipelineStage.findMany({ where: { companyId, pipelineId }, select: STAGE_SELECT, orderBy: STAGE_ORDER });
  },
  findStageByName(pipelineId: string, nameKey: string, excludeId?: string) {
    return prisma.crmPipelineStage.findFirst({ where: { pipelineId, nameKey, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true } });
  },
  stageKeyExists(pipelineId: string, key: string) {
    return prisma.crmPipelineStage.findFirst({ where: { pipelineId, key }, select: { id: true } }).then(Boolean);
  },
  maxStageSortOrder(pipelineId: string, db: CrmDb = prisma) {
    return db.crmPipelineStage.aggregate({ where: { pipelineId }, _max: { sortOrder: true } }).then((r) => r._max.sortOrder ?? 0);
  },

  // ── Transition rules ──
  rulesFrom(companyId: string, fromStageId: string, db: CrmDb = prisma) {
    return db.crmStageTransitionRule.findMany({ where: { companyId, fromStageId }, select: RULE_SELECT, orderBy: { createdAt: "asc" } });
  },
  rulesOfPipeline(companyId: string, pipelineId: string) {
    return prisma.crmStageTransitionRule.findMany({ where: { companyId, pipelineId }, select: RULE_SELECT, orderBy: { createdAt: "asc" } });
  },
  findRule(fromStageId: string, toStageId: string, db: CrmDb = prisma) {
    return db.crmStageTransitionRule.findFirst({ where: { fromStageId, toStageId }, select: RULE_SELECT });
  },

  // ── Usage (opportunities referencing a pipeline / stage) ──
  /** Counts by stage: total (incl. closed and archived records) and open-and-active. */
  async usageByStage(companyId: string, pipelineId: string) {
    const [all, open] = await Promise.all([
      prisma.crmOpportunity.groupBy({ by: ["stageId"], where: { companyId, pipelineId }, _count: { _all: true } }),
      prisma.crmOpportunity.groupBy({ by: ["stageId"], where: { companyId, pipelineId, status: "OPEN", archivedAt: null }, _count: { _all: true } }),
    ]);
    const openBy = new Map(open.map((r) => [r.stageId, r._count._all]));
    return all.map((r) => ({ stageId: r.stageId, total: r._count._all, open: openBy.get(r.stageId) ?? 0 }));
  },
  async usageByPipeline(companyId: string) {
    const [all, open] = await Promise.all([
      prisma.crmOpportunity.groupBy({ by: ["pipelineId"], where: { companyId }, _count: { _all: true } }),
      prisma.crmOpportunity.groupBy({ by: ["pipelineId"], where: { companyId, status: "OPEN", archivedAt: null }, _count: { _all: true } }),
    ]);
    const openBy = new Map(open.map((r) => [r.pipelineId, r._count._all]));
    return all.map((r) => ({ pipelineId: r.pipelineId, total: r._count._all, open: openBy.get(r.pipelineId) ?? 0 }));
  },
  opportunitiesInStage(companyId: string, stageId: string, db: CrmDb = prisma) {
    return db.crmOpportunity.findMany({ where: { companyId, stageId }, orderBy: { createdAt: "asc" } });
  },
  opportunitiesInPipeline(companyId: string, pipelineId: string, db: CrmDb = prisma) {
    return db.crmOpportunity.findMany({ where: { companyId, pipelineId }, orderBy: { createdAt: "asc" } });
  },
};
export type CrmStageRow = NonNullable<Awaited<ReturnType<typeof CrmPipelineRepository.findStage>>>;
export type CrmPipelineRow = NonNullable<Awaited<ReturnType<typeof CrmPipelineRepository.findPipeline>>>;
export type CrmTransitionRuleRow = Awaited<ReturnType<typeof CrmPipelineRepository.rulesFrom>>[number];

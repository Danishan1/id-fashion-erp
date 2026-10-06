import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { crmOwnerWhere, getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { CrmPipelineRepository } from "./crm-pipeline.repository";
import { boardQuerySchema } from "./pipeline.schema";

/**
 * Phase 07 — data foundations for the pipeline board (Phase 08 UI) and
 * pipeline reporting. Everything is aggregated in the database (groupBy /
 * one SQL funnel query) and respects the viewer's CRM record visibility;
 * the board returns at most `perStage` cards per stage. Values are totalled
 * per currency — amounts in different currencies are never added together.
 */

type MoneyTotals = { currencyCode: string | null; total: number; average: number | null; count: number }[];

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

async function loadPipeline(companyId: string, id: string) {
  const p = await CrmPipelineRepository.findPipelineWithStages(companyId, id);
  if (!p) throw new BusinessRuleError("NOT_FOUND", "Pipeline not found.", { id });
  return p;
}

function visibleWhere(actor: CrmActor, scope: CrmRecordScope, pipelineId: string): Prisma.CrmOpportunityWhereInput {
  return { AND: [{ companyId: actor.companyId, pipelineId, archivedAt: null }, crmOwnerWhere(scope) as Prisma.CrmOpportunityWhereInput] };
}

/** Board data: every stage in order with count, value totals and the first N records. */
export async function getPipelineBoard(actor: CrmActor, pipelineId: string, raw: Record<string, unknown>) {
  const q = boardQuerySchema.parse(raw);
  const pipeline = await loadPipeline(actor.companyId, pipelineId);
  const scope = await getCrmRecordScope(actor);
  const where: Prisma.CrmOpportunityWhereInput = {
    AND: [visibleWhere(actor, scope, pipelineId), q.status === "OPEN" ? { status: "OPEN" } : {}, q.ownerUserId ? { ownerUserId: q.ownerUserId } : {}],
  };
  const groups = await prisma.crmOpportunity.groupBy({ by: ["stageId", "currencyCode"], where, _count: { _all: true }, _sum: { amount: true } });
  const counts = new Map<string | null, number>();
  const values = new Map<string | null, { currencyCode: string | null; total: number }[]>();
  for (const g of groups) {
    counts.set(g.stageId, (counts.get(g.stageId) ?? 0) + g._count._all);
    if (g._sum.amount !== null) values.set(g.stageId, [...(values.get(g.stageId) ?? []), { currencyCode: g.currencyCode, total: num(g._sum.amount) }]);
  }
  // Archived stages are shown only while records still point at them (never after a reassign).
  const stages = pipeline.stages.filter((s) => !s.archivedAt || counts.get(s.id));
  const records = q.perStage
    ? await Promise.all(
        stages.map((s) =>
          prisma.crmOpportunity.findMany({
            where: { AND: [where, { stageId: s.id }] },
            orderBy: [{ stageChangedAt: "desc" }, { id: "asc" }],
            take: q.perStage,
            select: {
              id: true,
              opportunityNumber: true,
              name: true,
              status: true,
              amount: true,
              currencyCode: true,
              probability: true,
              probabilitySource: true,
              expectedCloseDate: true,
              stageChangedAt: true,
              version: true,
              owner: { select: { id: true, fullName: true } },
              crmCompany: { select: { id: true, name: true } },
              crmContact: { select: { id: true, fullName: true } },
            },
          })
        )
      )
    : stages.map(() => []);
  return {
    pipeline: { id: pipeline.id, name: pipeline.name, isDefault: pipeline.isDefault, archivedAt: pipeline.archivedAt },
    status: q.status,
    stages: stages.map((s, i) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      probability: s.probability,
      isDefault: s.isDefault,
      archived: Boolean(s.archivedAt),
      count: counts.get(s.id) ?? 0,
      values: values.get(s.id) ?? [],
      records: records[i].map((r) => ({ ...r, amount: r.amount === null ? null : r.amount.toString() })),
      hasMore: (counts.get(s.id) ?? 0) > records[i].length,
    })),
  };
}

function moneyTotals(groups: { currencyCode: string | null; _count: { _all: number }; _sum: { amount: Prisma.Decimal | null }; _avg: { amount: Prisma.Decimal | null } }[]): MoneyTotals {
  return groups.filter((g) => g._sum.amount !== null).map((g) => ({ currencyCode: g.currencyCode, total: num(g._sum.amount), average: g._avg.amount === null ? null : Math.round(num(g._avg.amount) * 100) / 100, count: g._count._all }));
}

/**
 * Pipeline report: totals, open / won / lost / abandoned, stage distribution
 * (open records) and conversion by stage. Conversion uses stage history: an
 * opportunity "reached" a stage if it was ever in that stage or a later one
 * of this pipeline; conversion = reached next stage ÷ reached this stage
 * (the last stage converts to Won). Only opportunities now in the pipeline
 * count; optional created-date range.
 */
export async function getPipelineReport(actor: CrmActor, pipelineId: string, range: { from?: string | null; to?: string | null } = {}) {
  const pipeline = await loadPipeline(actor.companyId, pipelineId);
  const scope = await getCrmRecordScope(actor);
  const created: Prisma.CrmOpportunityWhereInput = {
    ...(range.from || range.to ? { createdAt: { ...(range.from ? { gte: new Date(`${range.from}T00:00:00.000Z`) } : {}), ...(range.to ? { lt: new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}) } } : {}),
  };
  const where: Prisma.CrmOpportunityWhereInput = { AND: [visibleWhere(actor, scope, pipelineId), created] };
  const [byStatus, byStatusCurrency, byStageOpen, allCurrency] = await Promise.all([
    prisma.crmOpportunity.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.crmOpportunity.groupBy({ by: ["status", "currencyCode"], where, _count: { _all: true }, _sum: { amount: true } }),
    prisma.crmOpportunity.groupBy({ by: ["stageId", "currencyCode"], where: { AND: [where, { status: "OPEN" }] }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.crmOpportunity.groupBy({ by: ["currencyCode"], where, _count: { _all: true }, _sum: { amount: true }, _avg: { amount: true } }),
  ]);
  const statusCount = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
  const statusValue = (s: string) => byStatusCurrency.filter((g) => g.status === s && g._sum.amount !== null).map((g) => ({ currencyCode: g.currencyCode, total: num(g._sum.amount) }));
  const total = byStatus.reduce((n, g) => n + g._count._all, 0);
  const won = statusCount("WON");
  const closed = won + statusCount("LOST") + statusCount("ABANDONED");

  const funnel = await reachedByStage(actor, scope, pipelineId, range);
  const activeStages = pipeline.stages.filter((s) => !s.archivedAt);
  const reached = activeStages.map((s) => funnel.filter((f) => f.furthest >= s.sortOrder).reduce((n, f) => n + f.count, 0));
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

  const stageCount = (id: string) => byStageOpen.filter((g) => g.stageId === id).reduce((n, g) => n + g._count._all, 0);
  const open = statusCount("OPEN");
  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    range: { from: range.from ?? null, to: range.to ?? null },
    totals: { count: total, values: moneyTotals(allCurrency) },
    statuses: {
      open: { count: open, values: statusValue("OPEN") },
      won: { count: won, values: statusValue("WON") },
      lost: { count: statusCount("LOST"), values: statusValue("LOST") },
      abandoned: { count: statusCount("ABANDONED"), values: statusValue("ABANDONED") },
      winRate: pct(won, closed),
    },
    stages: activeStages.map((s, i) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      probability: s.probability,
      openCount: stageCount(s.id),
      openShare: pct(stageCount(s.id), open),
      openValues: byStageOpen.filter((g) => g.stageId === s.id && g._sum.amount !== null).map((g) => ({ currencyCode: g.currencyCode, total: num(g._sum.amount) })),
      reached: reached[i],
      conversionToNext: i < activeStages.length - 1 ? pct(reached[i + 1], reached[i]) : pct(won, reached[i]),
      nextLabel: i < activeStages.length - 1 ? activeStages[i + 1].name : "Won",
    })),
  };
}

/** Per opportunity, the furthest stage order reached in this pipeline (history ∪ current stage), grouped. */
async function reachedByStage(actor: CrmActor, scope: CrmRecordScope, pipelineId: string, range: { from?: string | null; to?: string | null }) {
  const scopeSql = scope.mode === "ALL" ? Prisma.empty : Prisma.sql`AND (o."owner_user_id" = ${scope.userId}::uuid OR (o."owner_user_id" IS NULL AND o."created_by_user_id" = ${scope.userId}::uuid))`;
  const fromSql = range.from ? Prisma.sql`AND o."created_at" >= ${new Date(`${range.from}T00:00:00.000Z`)}` : Prisma.empty;
  const toSql = range.to ? Prisma.sql`AND o."created_at" < ${new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + 86_400_000)}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ furthest: number; count: bigint }[]>`
    WITH visible AS (
      SELECT o."id", o."stage_id" FROM "crm_opportunities" o
      WHERE o."company_id" = ${actor.companyId}::uuid AND o."pipeline_id" = ${pipelineId}::uuid AND o."archived_at" IS NULL ${scopeSql} ${fromSql} ${toSql}
    ), touched AS (
      SELECT v."id", v."stage_id" AS sid FROM visible v
      UNION ALL
      SELECT h."opportunity_id", h."to_stage_id" FROM "crm_opportunity_stage_history" h
      JOIN visible v ON v."id" = h."opportunity_id"
      WHERE h."company_id" = ${actor.companyId}::uuid AND h."to_pipeline_id" = ${pipelineId}::uuid
    ), furthest AS (
      SELECT t."id", MAX(s."sort_order") AS furthest FROM touched t
      JOIN "crm_pipeline_stages" s ON s."id" = t.sid AND s."pipeline_id" = ${pipelineId}::uuid
      GROUP BY t."id"
    )
    SELECT furthest, COUNT(*) AS count FROM furthest GROUP BY furthest`;
  return rows.map((r) => ({ furthest: Number(r.furthest), count: Number(r.count) }));
}

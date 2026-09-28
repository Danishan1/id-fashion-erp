import type { Prisma, StageCostSource } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { SaveStageCostsInput } from "./stage-cost.schema";

/**
 * Stage-wise job-work costing (2026-09-28).
 *
 *   Master Style default (StyleStageCost)
 *     ↓  inherited unless overridden
 *   Design override (DesignStageCost — only overridden stages have a row)
 *     ↓  suggested, editable per transaction
 *   Job Work Order (JobWorkOrderStage — rate frozen at creation)
 *
 * Because a Design row exists ONLY for an overridden stage, changing a Style
 * default automatically flows to every non-customized Design, but never
 * touches a customized one — and never touches an already-created Job Work
 * Order, whose rates are snapshotted.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

type Client = Prisma.TransactionClient | typeof prisma;

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

async function loadStages(companyId: string, extraStageIds: string[] = []) {
  return prisma.productionStage.findMany({
    where: { companyId, OR: [{ isActive: true }, { id: { in: extraStageIds } }] },
    select: { id: true, code: true, name: true, sequence: true, isActive: true, isFinal: true },
    orderBy: { sequence: "asc" },
  });
}

async function assertStagesBelongToCompany(client: Client, companyId: string, stageIds: string[]) {
  if (!stageIds.length) return;
  const found = await client.productionStage.findMany({ where: { companyId, id: { in: stageIds } }, select: { id: true } });
  const ok = new Set(found.map((s) => s.id));
  const missing = stageIds.find((id) => !ok.has(id));
  if (missing) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id: missing });
}

// ───────────────────────── Master Style ─────────────────────────

async function requireStyle(companyId: string, productId: string) {
  const style = await prisma.product.findFirst({
    where: { id: productId, companyId, itemType: "STYLE", deletedAt: null },
    select: { id: true, styleName: true, styleCode: true },
  });
  if (!style) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });
  return style;
}

export async function getStyleStageCosts(companyId: string, productId: string) {
  const style = await requireStyle(companyId, productId);
  const rows = await prisma.styleStageCost.findMany({ where: { companyId, productId } });
  const byStage = new Map(rows.map((r) => [r.productionStageId, r]));
  const stages = await loadStages(companyId, rows.map((r) => r.productionStageId));
  return {
    style,
    stages: stages.map((stage) => {
      const row = byStage.get(stage.id);
      return { stage, cost: num(row?.cost), updatedAt: row?.updatedAt ?? null };
    }),
  };
}

export async function saveStyleStageCosts(actor: ActorContext, productId: string, input: SaveStageCostsInput) {
  await requireStyle(actor.companyId, productId);
  const stageIds = input.costs.map((c) => c.productionStageId);

  const before = await prisma.styleStageCost.findMany({ where: { companyId: actor.companyId, productId } });

  await prisma.$transaction(async (tx) => {
    await assertStagesBelongToCompany(tx, actor.companyId, stageIds);
    for (const entry of input.costs) {
      if (entry.cost === null) {
        await tx.styleStageCost.deleteMany({ where: { productId, productionStageId: entry.productionStageId } });
      } else {
        await tx.styleStageCost.upsert({
          where: { productId_productionStageId: { productId, productionStageId: entry.productionStageId } },
          create: {
            companyId: actor.companyId,
            productId,
            productionStageId: entry.productionStageId,
            cost: entry.cost,
            updatedByUserId: actor.userId,
          },
          update: { cost: entry.cost, updatedByUserId: actor.userId },
        });
      }
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "style_stage_costs",
    recordId: productId,
    action: "UPDATE",
    oldValues: { costs: before.map((r) => ({ productionStageId: r.productionStageId, cost: Number(r.cost) })) },
    newValues: { costs: input.costs },
  });

  return getStyleStageCosts(actor.companyId, productId);
}

// ───────────────────────── Design ─────────────────────────

async function requireDesign(companyId: string, sampleRequestId: string) {
  const design = await prisma.sampleRequest.findFirst({
    where: { id: sampleRequestId, companyId },
    select: { id: true, requestNumber: true, styleName: true, productId: true, product: { select: { styleName: true } } },
  });
  if (!design) throw new BusinessRuleError("NOT_FOUND", "Design not found.", { id: sampleRequestId });
  return design;
}

export async function getDesignStageCosts(companyId: string, sampleRequestId: string) {
  const design = await requireDesign(companyId, sampleRequestId);
  const [overrides, styleRows] = await Promise.all([
    prisma.designStageCost.findMany({ where: { companyId, sampleRequestId } }),
    design.productId ? prisma.styleStageCost.findMany({ where: { companyId, productId: design.productId } }) : Promise.resolve([]),
  ]);
  const overrideByStage = new Map(overrides.map((r) => [r.productionStageId, r]));
  const styleByStage = new Map(styleRows.map((r) => [r.productionStageId, r]));
  const stages = await loadStages(companyId, [...overrides, ...styleRows].map((r) => r.productionStageId));

  return {
    design,
    stages: stages.map((stage) => {
      const override = overrideByStage.get(stage.id);
      const styleDefault = num(styleByStage.get(stage.id)?.cost);
      const designCost = num(override?.cost);
      const effective = designCost ?? styleDefault;
      const source: StageCostSource = designCost !== null ? "DESIGN_OVERRIDE" : styleDefault !== null ? "STYLE_DEFAULT" : "NOT_CONFIGURED";
      return { stage, styleDefault, designCost, effective, source };
    }),
  };
}

export async function saveDesignStageCosts(actor: ActorContext, sampleRequestId: string, input: SaveStageCostsInput) {
  await requireDesign(actor.companyId, sampleRequestId);
  const stageIds = input.costs.map((c) => c.productionStageId);
  const before = await prisma.designStageCost.findMany({ where: { companyId: actor.companyId, sampleRequestId } });

  await prisma.$transaction(async (tx) => {
    await assertStagesBelongToCompany(tx, actor.companyId, stageIds);
    for (const entry of input.costs) {
      if (entry.cost === null) {
        // Revert this stage to the inherited Style default.
        await tx.designStageCost.deleteMany({ where: { sampleRequestId, productionStageId: entry.productionStageId } });
      } else {
        await tx.designStageCost.upsert({
          where: { sampleRequestId_productionStageId: { sampleRequestId, productionStageId: entry.productionStageId } },
          create: {
            companyId: actor.companyId,
            sampleRequestId,
            productionStageId: entry.productionStageId,
            cost: entry.cost,
            updatedByUserId: actor.userId,
          },
          update: { cost: entry.cost, updatedByUserId: actor.userId },
        });
      }
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "design_stage_costs",
    recordId: sampleRequestId,
    action: "UPDATE",
    oldValues: { costs: before.map((r) => ({ productionStageId: r.productionStageId, cost: Number(r.cost) })) },
    newValues: { costs: input.costs },
  });

  return getDesignStageCosts(actor.companyId, sampleRequestId);
}

// ───────────────────────── Resolution ─────────────────────────

export interface ResolvedStageCost {
  productionStageId: string;
  rate: number | null;
  source: StageCostSource;
}

/**
 * Effective per-piece rate for each requested stage: Design override →
 * Style default → not configured. `sampleRequestId` is optional (a
 * make-to-stock or direct order has no design).
 */
export async function resolveEffectiveStageCosts(
  client: Client,
  companyId: string,
  params: { productId: string; sampleRequestId: string | null; stageIds: string[] },
): Promise<Map<string, ResolvedStageCost>> {
  const [styleRows, designRows] = await Promise.all([
    client.styleStageCost.findMany({ where: { companyId, productId: params.productId, productionStageId: { in: params.stageIds } } }),
    params.sampleRequestId
      ? client.designStageCost.findMany({
          where: { companyId, sampleRequestId: params.sampleRequestId, productionStageId: { in: params.stageIds } },
        })
      : Promise.resolve([]),
  ]);
  const styleBy = new Map(styleRows.map((r) => [r.productionStageId, Number(r.cost)]));
  const designBy = new Map(designRows.map((r) => [r.productionStageId, Number(r.cost)]));
  const result = new Map<string, ResolvedStageCost>();
  for (const stageId of params.stageIds) {
    if (designBy.has(stageId)) result.set(stageId, { productionStageId: stageId, rate: designBy.get(stageId)!, source: "DESIGN_OVERRIDE" });
    else if (styleBy.has(stageId)) result.set(stageId, { productionStageId: stageId, rate: styleBy.get(stageId)!, source: "STYLE_DEFAULT" });
    else result.set(stageId, { productionStageId: stageId, rate: null, source: "NOT_CONFIGURED" });
  }
  return result;
}

/** Style + design a job order's production traces back to (design via Sales Order line, if any). */
export async function resolveCostContextForProductionOrder(client: Client, companyId: string, productionOrderId: string) {
  const order = await client.productionOrder.findFirst({
    where: { id: productionOrderId, companyId },
    select: {
      productId: true,
      product: { select: { styleName: true, styleCode: true } },
      salesOrderItem: { select: { sampleRequestId: true, sampleRequest: { select: { requestNumber: true, styleName: true } } } },
    },
  });
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });
  return {
    productId: order.productId,
    styleName: order.product.styleName,
    styleCode: order.product.styleCode,
    sampleRequestId: order.salesOrderItem?.sampleRequestId ?? null,
    designLabel: order.salesOrderItem?.sampleRequest
      ? `${order.salesOrderItem.sampleRequest.styleName ?? ""} (${order.salesOrderItem.sampleRequest.requestNumber})`.trim()
      : null,
  };
}

/** Money rounding to paise, normalizing -0. */
export function round2(v: number) {
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r;
}

import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ProductionLineInput, ProductionStageInput, SalesAgentInput } from "./production-config.schema";

interface ActorContext {
  companyId: string;
}

// ── Production Stages ────────────────────────────────────────────────────

export async function listProductionStages(companyId: string) {
  return prisma.productionStage.findMany({ where: { companyId }, orderBy: { sequence: "asc" } });
}

export async function createProductionStage(actor: ActorContext, input: ProductionStageInput) {
  const existing = await prisma.productionStage.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Stage code "${input.code}" is already in use.`);

  return prisma.productionStage.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      sequence: input.sequence,
      isActive: input.isActive,
    },
  });
}

export async function updateProductionStage(actor: ActorContext, id: string, input: ProductionStageInput) {
  return prisma.productionStage.update({
    where: { id },
    data: { code: input.code, name: input.name, sequence: input.sequence, isActive: input.isActive },
  });
}

// ── Production Lines ─────────────────────────────────────────────────────

export async function listProductionLines(companyId: string) {
  return prisma.productionLine.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createProductionLine(actor: ActorContext, input: ProductionLineInput) {
  const existing = await prisma.productionLine.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Line code "${input.code}" is already in use.`);

  return prisma.productionLine.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      capacityPerDay: input.capacityPerDay ?? null,
      isActive: input.isActive,
    },
  });
}

export async function updateProductionLine(actor: ActorContext, id: string, input: ProductionLineInput) {
  return prisma.productionLine.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      capacityPerDay: input.capacityPerDay ?? null,
      isActive: input.isActive,
    },
  });
}

// ── Sales Agents ──────────────────────────────────────────────────────────

export async function listSalesAgents(companyId: string) {
  return prisma.salesAgent.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createSalesAgent(actor: ActorContext, input: SalesAgentInput) {
  const existing = await prisma.salesAgent.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Agent code "${input.code}" is already in use.`);

  return prisma.salesAgent.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      contactPerson: input.contactPerson || null,
      email: input.email || null,
      phone: input.phone || null,
      commissionPercent: input.commissionPercent ?? null,
      isActive: input.isActive,
    },
  });
}

export async function updateSalesAgent(actor: ActorContext, id: string, input: SalesAgentInput) {
  return prisma.salesAgent.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      contactPerson: input.contactPerson || null,
      email: input.email || null,
      phone: input.phone || null,
      commissionPercent: input.commissionPercent ?? null,
      isActive: input.isActive,
    },
  });
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { MachineInput, ProductionLineInput, ProductionStageInput, SalesAgentInput } from "./production-config.schema";
import { ProductionConfigRepository } from "./production-config.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

// ── Production Stages ────────────────────────────────────────────────────

export async function listProductionStages(companyId: string) {
  return ProductionConfigRepository.stage.findMany({ where: { companyId }, orderBy: { sequence: "asc" } });
}

export async function createProductionStage(actor: ActorContext, input: ProductionStageInput) {
  const existing = await ProductionConfigRepository.stage.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Stage code "${input.code}" is already in use.`);

  const stage = await ProductionConfigRepository.stage.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      sequence: input.sequence,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_stages",
    recordId: stage.id,
    action: "CREATE",
    newValues: stage,
  });

  return stage;
}

export async function updateProductionStage(actor: ActorContext, id: string, input: ProductionStageInput) {
  const updated = await ProductionConfigRepository.stage.update({
    where: { id },
    data: { code: input.code, name: input.name, sequence: input.sequence, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_stages",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Production Lines ─────────────────────────────────────────────────────

export async function listProductionLines(companyId: string) {
  return ProductionConfigRepository.line.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createProductionLine(actor: ActorContext, input: ProductionLineInput) {
  const existing = await ProductionConfigRepository.line.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Line code "${input.code}" is already in use.`);

  const line = await ProductionConfigRepository.line.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      capacityPerDay: input.capacityPerDay ?? null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_lines",
    recordId: line.id,
    action: "CREATE",
    newValues: line,
  });

  return line;
}

export async function updateProductionLine(actor: ActorContext, id: string, input: ProductionLineInput) {
  const updated = await ProductionConfigRepository.line.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      capacityPerDay: input.capacityPerDay ?? null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_lines",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Machines ──────────────────────────────────────────────────────────────

export async function listMachines(companyId: string) {
  return ProductionConfigRepository.machine.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createMachine(actor: ActorContext, input: MachineInput) {
  const existing = await ProductionConfigRepository.machine.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Machine code "${input.code}" is already in use.`);

  const machine = await ProductionConfigRepository.machine.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      productionLineId: input.productionLineId || null,
      machineType: input.machineType || null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "machines",
    recordId: machine.id,
    action: "CREATE",
    newValues: machine,
  });

  return machine;
}

export async function updateMachine(actor: ActorContext, id: string, input: MachineInput) {
  const updated = await ProductionConfigRepository.machine.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      productionLineId: input.productionLineId || null,
      machineType: input.machineType || null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "machines",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Sales Agents ──────────────────────────────────────────────────────────

export async function listSalesAgents(companyId: string) {
  return ProductionConfigRepository.salesAgent.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createSalesAgent(actor: ActorContext, input: SalesAgentInput) {
  const existing = await ProductionConfigRepository.salesAgent.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Agent code "${input.code}" is already in use.`);

  const agent = await ProductionConfigRepository.salesAgent.create({
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

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_agents",
    recordId: agent.id,
    action: "CREATE",
    newValues: agent,
  });

  return agent;
}

export async function updateSalesAgent(actor: ActorContext, id: string, input: SalesAgentInput) {
  const updated = await ProductionConfigRepository.salesAgent.update({
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

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_agents",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

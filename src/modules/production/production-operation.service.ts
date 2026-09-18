import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { ProductionOperationRepository } from "./production.repository";
import type { ActorContext } from "./production-order.service";

export interface ProductionOperationInput {
  code: string;
  name: string;
  productionStageId?: string | null;
}

export async function listProductionOperations(companyId: string) {
  return ProductionOperationRepository.findMany(companyId);
}

export async function createProductionOperation(actor: ActorContext, input: ProductionOperationInput) {
  const existing = await ProductionOperationRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Operation code "${input.code}" is already in use.`, { code: input.code });
  }

  const operation = await ProductionOperationRepository.create({
    companyId: actor.companyId,
    code: input.code,
    name: input.name,
    productionStageId: input.productionStageId || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_operations",
    recordId: operation.id,
    action: "CREATE",
    newValues: { code: operation.code, name: operation.name },
  });

  return operation;
}

export async function updateProductionOperation(actor: ActorContext, id: string, input: ProductionOperationInput) {
  const existing = await ProductionOperationRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Production operation not found.", { id });

  if (input.code !== existing.code) {
    const duplicate = await ProductionOperationRepository.findByCode(actor.companyId, input.code);
    if (duplicate) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Operation code "${input.code}" is already in use.`, { code: input.code });
    }
  }

  const updated = await ProductionOperationRepository.update(id, {
    code: input.code,
    name: input.name,
    productionStageId: input.productionStageId || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_operations",
    recordId: id,
    action: "UPDATE",
    oldValues: { code: existing.code, name: existing.name },
    newValues: { code: updated.code, name: updated.name },
  });

  return updated;
}

export async function setProductionOperationActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await ProductionOperationRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Production operation not found.", { id });

  const updated = await ProductionOperationRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_operations",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });

  return updated;
}

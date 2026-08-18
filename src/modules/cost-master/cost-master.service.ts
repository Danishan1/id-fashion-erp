import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CostMasterInput } from "./cost-master.schema";
import { CostMasterRepository } from "./cost-master.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listCostMasters(companyId: string) {
  return CostMasterRepository.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createCostMaster(actor: ActorContext, input: CostMasterInput) {
  const existing = await CostMasterRepository.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Cost master code "${input.code}" is already in use.`);

  const costMaster = await CostMasterRepository.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      type: input.type,
      rate: input.rate,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "cost_masters",
    recordId: costMaster.id,
    action: "CREATE",
    newValues: costMaster,
  });

  return costMaster;
}

export async function updateCostMaster(actor: ActorContext, id: string, input: CostMasterInput) {
  const updated = await CostMasterRepository.update({
    where: { id },
    data: { code: input.code, name: input.name, type: input.type, rate: input.rate, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "cost_masters",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

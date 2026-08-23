import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { DefectTypeRepository } from "./production.repository";
import type { DefectTypeInput } from "./production.schema";
import type { ActorContext } from "./production-order.service";

export async function listDefectTypes(companyId: string) {
  return DefectTypeRepository.findMany(companyId);
}

export async function createDefectType(actor: ActorContext, input: DefectTypeInput) {
  const created = await DefectTypeRepository.create({ companyId: actor.companyId, code: input.code, name: input.name });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "defect_types",
    recordId: created.id,
    action: "CREATE",
    newValues: input,
  });

  return created;
}

export async function updateDefectType(actor: ActorContext, id: string, input: DefectTypeInput & { isActive?: boolean }) {
  const existing = await DefectTypeRepository.findFirst(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Defect type not found.", { id });

  const updated = await DefectTypeRepository.update(id, {
    code: input.code,
    name: input.name,
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "defect_types",
    recordId: id,
    action: "UPDATE",
    oldValues: { code: existing.code, name: existing.name, isActive: existing.isActive },
    newValues: input,
  });

  return updated;
}

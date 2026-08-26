import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { BranchRepository } from "./branch.repository";
import type { BranchInput } from "./branch.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
}

export function listBranches(companyId: string) {
  return BranchRepository.findMany(companyId);
}

export async function getBranchById(companyId: string, id: string) {
  const branch = await BranchRepository.findById(companyId, id);
  if (!branch) throw new BusinessRuleError("NOT_FOUND", "Branch not found.", { id });
  return branch;
}

export async function createBranch(actor: ActorContext, input: BranchInput) {
  const existing = await BranchRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Branch code "${input.code}" is already in use.`, { code: input.code });
  }

  const branch = await BranchRepository.create({
    companyId: actor.companyId,
    code: input.code,
    name: input.name,
    type: input.type,
    addressJson: input.addressLine ? { line1: input.addressLine } : undefined,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "branches",
    recordId: branch.id,
    action: "CREATE",
    newValues: branch,
  });

  return branch;
}

export async function updateBranch(actor: ActorContext, id: string, input: BranchInput) {
  const existing = await getBranchById(actor.companyId, id);

  if (input.code !== existing.code) {
    const codeOwner = await BranchRepository.findByCode(actor.companyId, input.code);
    if (codeOwner && codeOwner.id !== id) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Branch code "${input.code}" is already in use.`, { code: input.code });
    }
  }

  const updated = await BranchRepository.update(id, {
    code: input.code,
    name: input.name,
    type: input.type,
    addressJson: input.addressLine ? { line1: input.addressLine } : undefined,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "branches",
    recordId: id,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });

  return updated;
}

export async function setBranchActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await getBranchById(actor.companyId, id);
  const updated = await BranchRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "branches",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });

  return updated;
}

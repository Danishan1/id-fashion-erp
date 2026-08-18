import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ColorInput, SizeInput, UnitInput } from "./lookup.schema";
import { LookupRepository } from "./lookup.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

// ── Colors ──────────────────────────────────────────────────────────────

export async function listColors(companyId: string) {
  return LookupRepository.color.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createColor(actor: ActorContext, input: ColorInput) {
  const existing = await LookupRepository.color.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Color code "${input.code}" is already in use.`);

  const color = await LookupRepository.color.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      hexValue: input.hexValue || null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "colors",
    recordId: color.id,
    action: "CREATE",
    newValues: color,
  });

  return color;
}

export async function updateColor(actor: ActorContext, id: string, input: ColorInput) {
  const updated = await LookupRepository.color.update({
    where: { id },
    data: { code: input.code, name: input.name, hexValue: input.hexValue || null, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "colors",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Sizes ───────────────────────────────────────────────────────────────

export async function listSizes(companyId: string) {
  return LookupRepository.size.findMany({ where: { companyId }, orderBy: { sortOrder: "asc" } });
}

export async function createSize(actor: ActorContext, input: SizeInput) {
  const existing = await LookupRepository.size.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Size code "${input.code}" is already in use.`);

  const size = await LookupRepository.size.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sizes",
    recordId: size.id,
    action: "CREATE",
    newValues: size,
  });

  return size;
}

export async function updateSize(actor: ActorContext, id: string, input: SizeInput) {
  const updated = await LookupRepository.size.update({
    where: { id },
    data: { code: input.code, name: input.name, sortOrder: input.sortOrder, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sizes",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Units of Measure (global, not company-scoped) ────────────────────────

export async function listUnits() {
  return LookupRepository.unit.findMany({ orderBy: { code: "asc" } });
}

export async function createUnit(actor: ActorContext, input: UnitInput) {
  const existing = await LookupRepository.unit.findUnique({ where: { code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Unit code "${input.code}" is already in use.`);

  const unit = await LookupRepository.unit.create({
    data: { code: input.code, name: input.name, conversionFactor: input.conversionFactor },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "units_of_measure",
    recordId: unit.id,
    action: "CREATE",
    newValues: unit,
  });

  return unit;
}

export async function updateUnit(actor: ActorContext, id: string, input: UnitInput) {
  const updated = await LookupRepository.unit.update({
    where: { id },
    data: { code: input.code, name: input.name, conversionFactor: input.conversionFactor },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "units_of_measure",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

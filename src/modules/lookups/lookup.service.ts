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
      isActive: input.isActive ?? true,
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
  const existing = await LookupRepository.color.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Color not found.", { id });

  const updated = await LookupRepository.color.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      hexValue: input.hexValue || null,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    },
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
      isActive: input.isActive ?? true,
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
  const existing = await LookupRepository.size.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Size not found.", { id });

  const updated = await LookupRepository.size.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    },
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

/**
 * A derived unit's base must itself be a root unit (baseUnitId === null) — enforced here so
 * convertUomQuantity (src/lib/uom-conversion.ts) only ever needs to handle depth-1 chains, never
 * a multi-hop one. Also rejects pointing a unit at itself.
 */
async function assertValidBaseUnit(baseUnitId: string, unitIdBeingSaved?: string) {
  if (baseUnitId === unitIdBeingSaved) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A unit cannot be its own base unit.");
  }
  const baseUnit = await LookupRepository.unit.findUnique({ where: { id: baseUnitId } });
  if (!baseUnit) throw new BusinessRuleError("NOT_FOUND", "Base unit not found.", { id: baseUnitId });
  if (baseUnit.baseUnitId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `"${baseUnit.name}" is itself a derived unit — a base unit must be a root unit, not a chain.`
    );
  }
}

export async function createUnit(actor: ActorContext, input: UnitInput) {
  const existing = await LookupRepository.unit.findUnique({ where: { code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Unit code "${input.code}" is already in use.`);

  if (input.baseUnitId) await assertValidBaseUnit(input.baseUnitId);

  const unit = await LookupRepository.unit.create({
    data: {
      code: input.code,
      name: input.name,
      conversionFactor: input.conversionFactor,
      baseUnitId: input.baseUnitId || null,
      isActive: input.isActive ?? true,
    },
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
  const existing = await LookupRepository.unit.findUnique({ where: { id } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id });

  if (input.baseUnitId) await assertValidBaseUnit(input.baseUnitId, id);

  const updated = await LookupRepository.unit.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      conversionFactor: input.conversionFactor,
      baseUnitId: input.baseUnitId || null,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    },
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

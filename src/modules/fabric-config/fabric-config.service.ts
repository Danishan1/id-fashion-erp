import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type {
  FabricCompositionInput,
  FabricDyeInput,
  FabricDyeTypeInput,
  FabricGsmInput,
  FabricWeaveTypeInput,
  FabricWidthInput,
} from "./fabric-config.schema";
import { FabricConfigRepository } from "./fabric-config.repository";
import { LookupRepository } from "@/modules/lookups/lookup.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

async function assertDyeTypeBelongsToCompany(companyId: string, dyeTypeId: string | undefined) {
  if (!dyeTypeId) return;
  const dyeType = await FabricConfigRepository.dyeType.findFirst({ where: { id: dyeTypeId, companyId } });
  if (!dyeType) throw new BusinessRuleError("NOT_FOUND", "Dye type not found.", { dyeTypeId });
}

// UnitOfMeasure is deliberately global (no companyId column), so this checks
// existence only — not company ownership, unlike the dye-type check above.
async function assertUnitExists(unitId: string | undefined) {
  if (!unitId) return;
  const unit = await LookupRepository.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { unitId });
}

// ── Fabric GSM ───────────────────────────────────────────────────────────

export async function listFabricGsms(companyId: string) {
  return FabricConfigRepository.gsm.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createFabricGsm(actor: ActorContext, input: FabricGsmInput) {
  const existing = await FabricConfigRepository.gsm.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `GSM code "${input.code}" is already in use.`);

  const gsm = await FabricConfigRepository.gsm.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_gsms",
    recordId: gsm.id,
    action: "CREATE",
    newValues: gsm,
  });

  return gsm;
}

export async function updateFabricGsm(actor: ActorContext, id: string, input: FabricGsmInput) {
  const existing = await FabricConfigRepository.gsm.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "GSM not found.", { id });

  const updated = await FabricConfigRepository.gsm.update({
    where: { id },
    data: { code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_gsms",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Fabric Dye ────────────────────────────────────────────────────────────

export async function listFabricDyes(companyId: string) {
  return FabricConfigRepository.dye.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createFabricDye(actor: ActorContext, input: FabricDyeInput) {
  const existing = await FabricConfigRepository.dye.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Dye code "${input.code}" is already in use.`);
  await assertDyeTypeBelongsToCompany(actor.companyId, input.dyeTypeId);

  const dye = await FabricConfigRepository.dye.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      pantone: input.pantone || null,
      dyeTypeId: input.dyeTypeId || null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_dyes",
    recordId: dye.id,
    action: "CREATE",
    newValues: dye,
  });

  return dye;
}

export async function updateFabricDye(actor: ActorContext, id: string, input: FabricDyeInput) {
  const existing = await FabricConfigRepository.dye.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dye not found.", { id });
  await assertDyeTypeBelongsToCompany(actor.companyId, input.dyeTypeId);

  // dyeTypeId is no longer submitted by the Dye tab's own form (removed from its
  // UI field list) — an omitted field must preserve the existing link, not silently
  // clear it on every routine Code/Name/Pantone edit. A direct API caller can still
  // set or clear it explicitly (empty string clears, matching this project's
  // established isActive/employeeId omit-vs-explicit-empty convention).
  const dyeTypeId = input.dyeTypeId !== undefined ? input.dyeTypeId || null : existing.dyeTypeId;

  const updated = await FabricConfigRepository.dye.update({
    where: { id },
    data: { code: input.code, name: input.name, pantone: input.pantone || null, dyeTypeId, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_dyes",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Fabric Dye Type ──────────────────────────────────────────────────────

export async function listFabricDyeTypes(companyId: string) {
  return FabricConfigRepository.dyeType.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createFabricDyeType(actor: ActorContext, input: FabricDyeTypeInput) {
  const existing = await FabricConfigRepository.dyeType.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Dye type code "${input.code}" is already in use.`);

  const dyeType = await FabricConfigRepository.dyeType.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_dye_types",
    recordId: dyeType.id,
    action: "CREATE",
    newValues: dyeType,
  });

  return dyeType;
}

export async function updateFabricDyeType(actor: ActorContext, id: string, input: FabricDyeTypeInput) {
  const existing = await FabricConfigRepository.dyeType.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dye type not found.", { id });

  const updated = await FabricConfigRepository.dyeType.update({
    where: { id },
    data: { code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_dye_types",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Fabric Weave Type ────────────────────────────────────────────────────

export async function listFabricWeaveTypes(companyId: string) {
  return FabricConfigRepository.weaveType.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createFabricWeaveType(actor: ActorContext, input: FabricWeaveTypeInput) {
  const existing = await FabricConfigRepository.weaveType.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Weave type code "${input.code}" is already in use.`);

  const weaveType = await FabricConfigRepository.weaveType.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_weave_types",
    recordId: weaveType.id,
    action: "CREATE",
    newValues: weaveType,
  });

  return weaveType;
}

export async function updateFabricWeaveType(actor: ActorContext, id: string, input: FabricWeaveTypeInput) {
  const existing = await FabricConfigRepository.weaveType.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Weave type not found.", { id });

  const updated = await FabricConfigRepository.weaveType.update({
    where: { id },
    data: { code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_weave_types",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Fabric Width ──────────────────────────────────────────────────────────

export async function listFabricWidths(companyId: string) {
  return FabricConfigRepository.width.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createFabricWidth(actor: ActorContext, input: FabricWidthInput) {
  const existing = await FabricConfigRepository.width.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Width code "${input.code}" is already in use.`);
  await assertUnitExists(input.unitId);

  const width = await FabricConfigRepository.width.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, unitId: input.unitId || null, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_widths",
    recordId: width.id,
    action: "CREATE",
    newValues: width,
  });

  return width;
}

export async function updateFabricWidth(actor: ActorContext, id: string, input: FabricWidthInput) {
  const existing = await FabricConfigRepository.width.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Width not found.", { id });
  await assertUnitExists(input.unitId);

  const updated = await FabricConfigRepository.width.update({
    where: { id },
    data: { code: input.code, name: input.name, unitId: input.unitId || null, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_widths",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Fabric Composition ───────────────────────────────────────────────────

export async function listFabricCompositions(companyId: string) {
  return FabricConfigRepository.composition.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createFabricComposition(actor: ActorContext, input: FabricCompositionInput) {
  const existing = await FabricConfigRepository.composition.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Composition code "${input.code}" is already in use.`);

  const composition = await FabricConfigRepository.composition.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_compositions",
    recordId: composition.id,
    action: "CREATE",
    newValues: composition,
  });

  return composition;
}

export async function updateFabricComposition(actor: ActorContext, id: string, input: FabricCompositionInput) {
  const existing = await FabricConfigRepository.composition.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Composition not found.", { id });

  const updated = await FabricConfigRepository.composition.update({
    where: { id },
    data: { code: input.code, name: input.name, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "fabric_compositions",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

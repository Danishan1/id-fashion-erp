import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { TaxRateInput, TaxTypeInput } from "./tax-config.schema";
import { TaxRateRepository, TaxTypeRepository } from "./tax-config.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listTaxTypes(companyId: string) {
  return TaxTypeRepository.findMany({ companyId });
}

export async function createTaxType(actor: ActorContext, input: TaxTypeInput) {
  const existing = await TaxTypeRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Tax type code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const taxType = await TaxTypeRepository.create({ companyId: actor.companyId, code: input.code, name: input.name });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "tax_types",
    recordId: taxType.id,
    action: "CREATE",
    newValues: { code: taxType.code, name: taxType.name },
  });

  return taxType;
}

export async function updateTaxType(actor: ActorContext, id: string, input: TaxTypeInput) {
  const existing = await TaxTypeRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Tax type not found.", { id });

  if (input.code !== existing.code) {
    const duplicate = await TaxTypeRepository.findByCode(actor.companyId, input.code);
    if (duplicate) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Tax type code "${input.code}" is already in use.`, {
        code: input.code,
      });
    }
  }

  const updated = await TaxTypeRepository.update(id, { code: input.code, name: input.name });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "tax_types",
    recordId: id,
    action: "UPDATE",
    oldValues: { code: existing.code, name: existing.name },
    newValues: { code: updated.code, name: updated.name },
  });

  return updated;
}

export async function setTaxTypeActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await TaxTypeRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Tax type not found.", { id });

  const updated = await TaxTypeRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "tax_types",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });

  return updated;
}

export async function listTaxRates(companyId: string, taxTypeId?: string) {
  return TaxRateRepository.findMany({ companyId, ...(taxTypeId ? { taxTypeId } : {}) });
}

/**
 * [aFrom, aTo) overlaps [bFrom, bTo) where a null "to" means "still open
 * indefinitely" — the standard half-open-interval overlap test, treating a
 * missing end as +Infinity.
 */
function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo ?? new Date(8640000000000000);
  const bEnd = bTo ?? new Date(8640000000000000);
  return aFrom < bEnd && bFrom < aEnd;
}

async function assertNoOverlap(companyId: string, taxTypeId: string, effectiveFrom: Date, effectiveTo: Date | null, excludeId?: string) {
  const activeRates = await TaxRateRepository.findActiveByTaxType(companyId, taxTypeId, excludeId);
  const overlapping = activeRates.find((rate) => rangesOverlap(effectiveFrom, effectiveTo, rate.effectiveFrom, rate.effectiveTo));
  if (overlapping) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `This date range overlaps an existing active rate "${overlapping.name}" (effective ${overlapping.effectiveFrom.toISOString().slice(0, 10)}${
        overlapping.effectiveTo ? ` to ${overlapping.effectiveTo.toISOString().slice(0, 10)}` : " onward"
      }).`,
      { overlappingRateId: overlapping.id }
    );
  }
}

export async function createTaxRate(actor: ActorContext, input: TaxRateInput) {
  const taxType = await TaxTypeRepository.findAnyById(actor.companyId, input.taxTypeId);
  if (!taxType) throw new BusinessRuleError("NOT_FOUND", "Tax type not found.", { id: input.taxTypeId });

  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Effective-to date must be after the effective-from date.", {});
  }

  await assertNoOverlap(actor.companyId, input.taxTypeId, effectiveFrom, effectiveTo);

  const rate = await TaxRateRepository.create({
    companyId: actor.companyId,
    taxTypeId: input.taxTypeId,
    name: input.name,
    ratePercentage: input.ratePercentage,
    effectiveFrom,
    effectiveTo,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "tax_rates",
    recordId: rate.id,
    action: "CREATE",
    newValues: { name: rate.name, ratePercentage: rate.ratePercentage },
  });

  return rate;
}

export async function updateTaxRate(actor: ActorContext, id: string, input: TaxRateInput) {
  const existing = await TaxRateRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id });

  // Re-validated on update too, not just create — a taxTypeId from another
  // company would otherwise sit unvalidated on the record from here on.
  const taxType = await TaxTypeRepository.findAnyById(actor.companyId, input.taxTypeId);
  if (!taxType) throw new BusinessRuleError("NOT_FOUND", "Tax type not found.", { id: input.taxTypeId });

  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Effective-to date must be after the effective-from date.", {});
  }

  await assertNoOverlap(actor.companyId, input.taxTypeId, effectiveFrom, effectiveTo, id);

  const updated = await TaxRateRepository.update(id, {
    taxTypeId: input.taxTypeId,
    name: input.name,
    ratePercentage: input.ratePercentage,
    effectiveFrom,
    effectiveTo,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "tax_rates",
    recordId: id,
    action: "UPDATE",
    oldValues: { name: existing.name, ratePercentage: existing.ratePercentage },
    newValues: { name: updated.name, ratePercentage: updated.ratePercentage },
  });

  return updated;
}

export async function setTaxRateActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await TaxRateRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id });

  const updated = await TaxRateRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "tax_rates",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });

  return updated;
}

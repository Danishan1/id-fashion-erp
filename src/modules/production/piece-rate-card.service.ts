import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PieceRateCardRepository } from "./production.repository";
import type { ActorContext } from "./production-order.service";

export interface PieceRateCardInput {
  productionOperationId: string;
  productId?: string | null;
  employeeId?: string | null;
  employeeCategoryId?: string | null;
  rate: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/** [aFrom, aTo) overlaps [bFrom, bTo) where a null "to" means "still open
 * indefinitely" — the same half-open-interval overlap test already proven by
 * tax-config.service.ts's own rangesOverlap(). */
function rangesOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo ?? new Date(8640000000000000);
  const bEnd = bTo ?? new Date(8640000000000000);
  return aFrom < bEnd && bFrom < aEnd;
}

function assertSingleTier(input: PieceRateCardInput) {
  if (input.employeeId && input.employeeCategoryId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "A rate card row can be scoped to a specific worker OR a worker grade, never both.",
      {}
    );
  }
}

async function assertNoOverlap(
  companyId: string,
  input: PieceRateCardInput,
  effectiveFrom: Date,
  effectiveTo: Date | null,
  excludeId?: string
) {
  const candidates = await PieceRateCardRepository.findMatchingDimension(
    companyId,
    {
      productionOperationId: input.productionOperationId,
      productId: input.productId ?? null,
      employeeId: input.employeeId ?? null,
      employeeCategoryId: input.employeeCategoryId ?? null,
      supplierId: null,
    },
    excludeId
  );
  const overlapping = candidates.find((c) => rangesOverlap(effectiveFrom, effectiveTo, c.effectiveFrom, c.effectiveTo));
  if (overlapping) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `This date range overlaps an existing active rate (effective ${overlapping.effectiveFrom.toISOString().slice(0, 10)}${
        overlapping.effectiveTo ? ` to ${overlapping.effectiveTo.toISOString().slice(0, 10)}` : " onward"
      }) for the same worker/grade/style/operation combination.`,
      { overlappingRateCardId: overlapping.id }
    );
  }
}

export async function listPieceRateCards(
  companyId: string,
  filters: { productId?: string; productionOperationId?: string; employeeId?: string }
) {
  return PieceRateCardRepository.findMany({
    companyId,
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.productionOperationId ? { productionOperationId: filters.productionOperationId } : {}),
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
  });
}

export async function createPieceRateCard(actor: ActorContext, input: PieceRateCardInput) {
  assertSingleTier(input);

  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Effective-to date must be after the effective-from date.", {});
  }

  await assertNoOverlap(actor.companyId, input, effectiveFrom, effectiveTo);

  const card = await PieceRateCardRepository.create({
    companyId: actor.companyId,
    productionOperationId: input.productionOperationId,
    productId: input.productId || null,
    employeeId: input.employeeId || null,
    employeeCategoryId: input.employeeCategoryId || null,
    supplierId: null,
    rate: input.rate,
    effectiveFrom,
    effectiveTo,
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "piece_rate_cards",
    recordId: card.id,
    action: "CREATE",
    newValues: { productionOperationId: input.productionOperationId, rate: input.rate },
  });

  return card;
}

export async function updatePieceRateCard(actor: ActorContext, id: string, input: PieceRateCardInput) {
  assertSingleTier(input);

  const existing = await PieceRateCardRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Piece rate card not found.", { id });

  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Effective-to date must be after the effective-from date.", {});
  }

  await assertNoOverlap(actor.companyId, input, effectiveFrom, effectiveTo, id);

  const updated = await PieceRateCardRepository.update(id, {
    productionOperationId: input.productionOperationId,
    productId: input.productId || null,
    employeeId: input.employeeId || null,
    employeeCategoryId: input.employeeCategoryId || null,
    rate: input.rate,
    effectiveFrom,
    effectiveTo,
    updatedByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "piece_rate_cards",
    recordId: id,
    action: "UPDATE",
    oldValues: { rate: existing.rate },
    newValues: { rate: updated.rate },
  });

  return updated;
}

export async function setPieceRateCardActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await PieceRateCardRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Piece rate card not found.", { id });

  const updated = await PieceRateCardRepository.update(id, { isActive, updatedByUserId: actor.userId });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "piece_rate_cards",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });

  return updated;
}

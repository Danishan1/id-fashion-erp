import { prisma } from "@/core/db/client";
import type { RateCardRateSource } from "@prisma/client";
import { PieceRateCardRepository } from "./production.repository";

export type RateResolution =
  | { resolved: true; rate: number; source: RateCardRateSource | "EMPLOYEE_LEGACY"; rateCardId: string | null }
  | { resolved: false };

/**
 * Resolves the piece rate that applies for a given worker + operation
 * (+ optional Style), as of a given date — never a silent 0. Priority order,
 * first match wins: Worker-specific -> Worker Grade (Employee.employeeCategoryId)
 * -> Style+Operation default -> Operation-level fallback ->
 * Employee.pieceRatePerUnit (the pre-existing flat-rate field, kept as the
 * lowest-priority legacy fallback, never removed) -> unresolved.
 *
 * Every caller must treat `{ resolved: false }` as "block until a human
 * picks a rate" — never coerce to 0.
 */
export async function resolvePieceRate(params: {
  companyId: string;
  productId?: string | null;
  productionOperationId: string;
  employeeId: string;
  supplierId?: string | null;
  asOfDate: Date;
}): Promise<RateResolution> {
  const employee = await prisma.employee.findUnique({
    where: { id: params.employeeId },
    select: { employeeCategoryId: true, pieceRatePerUnit: true },
  });

  const activeAt = (card: { effectiveFrom: Date; effectiveTo: Date | null }) =>
    card.effectiveFrom <= params.asOfDate && (!card.effectiveTo || card.effectiveTo > params.asOfDate);

  // Tier 1: worker-specific — prefer a style-scoped row over a
  // style-agnostic one for the same worker.
  const workerSpecific = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
    productionOperationId: params.productionOperationId,
    employeeId: params.employeeId,
    employeeCategoryId: null,
    supplierId: null,
  });
  const workerSpecificMatch =
    workerSpecific.filter(activeAt).find((c) => c.productId === (params.productId ?? null)) ??
    workerSpecific.filter(activeAt).find((c) => c.productId === null);
  if (workerSpecificMatch) {
    return { resolved: true, rate: Number(workerSpecificMatch.rate), source: "WORKER_SPECIFIC", rateCardId: workerSpecificMatch.id };
  }

  // Tier 2: worker grade.
  if (employee?.employeeCategoryId) {
    const gradeCards = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
      productionOperationId: params.productionOperationId,
      employeeCategoryId: employee.employeeCategoryId,
      employeeId: null,
      supplierId: null,
    });
    const gradeMatch =
      gradeCards.filter(activeAt).find((c) => c.productId === (params.productId ?? null)) ??
      gradeCards.filter(activeAt).find((c) => c.productId === null);
    if (gradeMatch) {
      return { resolved: true, rate: Number(gradeMatch.rate), source: "WORKER_GRADE", rateCardId: gradeMatch.id };
    }
  }

  // Tier 3: Style + Operation default.
  if (params.productId) {
    const styleDefaults = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
      productionOperationId: params.productionOperationId,
      productId: params.productId,
      employeeId: null,
      employeeCategoryId: null,
      supplierId: null,
    });
    const styleMatch = styleDefaults.filter(activeAt)[0];
    if (styleMatch) {
      return { resolved: true, rate: Number(styleMatch.rate), source: "STYLE_OPERATION_DEFAULT", rateCardId: styleMatch.id };
    }
  }

  // Tier 4: Operation-level fallback (no product, no employee, no grade).
  const operationDefaults = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
    productionOperationId: params.productionOperationId,
    productId: null,
    employeeId: null,
    employeeCategoryId: null,
    supplierId: null,
  });
  const operationMatch = operationDefaults.filter(activeAt)[0];
  if (operationMatch) {
    return { resolved: true, rate: Number(operationMatch.rate), source: "OPERATION_DEFAULT", rateCardId: operationMatch.id };
  }

  // Tier 5: legacy per-employee flat rate — kept for backward compatibility,
  // never the primary mechanism going forward.
  if (employee?.pieceRatePerUnit !== null && employee?.pieceRatePerUnit !== undefined) {
    return { resolved: true, rate: Number(employee.pieceRatePerUnit), source: "EMPLOYEE_LEGACY", rateCardId: null };
  }

  return { resolved: false };
}

/**
 * The External Unit (Supplier) analogue of resolvePieceRate() — the
 * worker-specific/worker-grade tiers above are meaningless for a Supplier,
 * so this walks a shorter ladder over the SAME generalized PieceRateCard
 * table: Supplier+Operation (optionally Style-scoped) -> Operation-level
 * fallback (shared with the internal ladder) -> unresolved. Never a silent
 * 0 — same contract as resolvePieceRate().
 */
export async function resolveSupplierPieceRate(params: {
  companyId: string;
  productId?: string | null;
  productionOperationId: string;
  supplierId: string;
  asOfDate: Date;
}): Promise<RateResolution> {
  const activeAt = (card: { effectiveFrom: Date; effectiveTo: Date | null }) =>
    card.effectiveFrom <= params.asOfDate && (!card.effectiveTo || card.effectiveTo > params.asOfDate);

  const supplierCards = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
    productionOperationId: params.productionOperationId,
    supplierId: params.supplierId,
    employeeId: null,
    employeeCategoryId: null,
  });
  const supplierMatch =
    supplierCards.filter(activeAt).find((c) => c.productId === (params.productId ?? null)) ??
    supplierCards.filter(activeAt).find((c) => c.productId === null);
  if (supplierMatch) {
    return { resolved: true, rate: Number(supplierMatch.rate), source: "SUPPLIER_SPECIFIC", rateCardId: supplierMatch.id };
  }

  const operationDefaults = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
    productionOperationId: params.productionOperationId,
    productId: null,
    employeeId: null,
    employeeCategoryId: null,
    supplierId: null,
  });
  const operationMatch = operationDefaults.filter(activeAt)[0];
  if (operationMatch) {
    return { resolved: true, rate: Number(operationMatch.rate), source: "OPERATION_DEFAULT", rateCardId: operationMatch.id };
  }

  return { resolved: false };
}

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
  contractorId?: string | null;
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
    contractorId: null,
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
      contractorId: null,
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
      contractorId: null,
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
    contractorId: null,
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
 * The External Unit (Contractor) analogue of resolvePieceRate() — the
 * worker-specific/worker-grade tiers above are meaningless for a Contractor,
 * so this walks a shorter ladder over the SAME generalized PieceRateCard
 * table: Contractor+Operation (optionally Style-scoped) -> Operation-level
 * fallback (shared with the internal ladder) -> unresolved. Never a silent
 * 0 — same contract as resolvePieceRate(). The `source` returned when a
 * contractor-specific row matches stays the enum's own value name,
 * "SUPPLIER_SPECIFIC" (2026-09-25 Contractor-promotion rename) — renaming a
 * live Postgres enum value needs its own migration and isn't required here.
 */
export async function resolveContractorPieceRate(params: {
  companyId: string;
  productId?: string | null;
  productionOperationId: string;
  contractorId: string;
  asOfDate: Date;
}): Promise<RateResolution> {
  const activeAt = (card: { effectiveFrom: Date; effectiveTo: Date | null }) =>
    card.effectiveFrom <= params.asOfDate && (!card.effectiveTo || card.effectiveTo > params.asOfDate);

  const contractorCards = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
    productionOperationId: params.productionOperationId,
    contractorId: params.contractorId,
    employeeId: null,
    employeeCategoryId: null,
  });
  const contractorMatch =
    contractorCards.filter(activeAt).find((c) => c.productId === (params.productId ?? null)) ??
    contractorCards.filter(activeAt).find((c) => c.productId === null);
  if (contractorMatch) {
    return { resolved: true, rate: Number(contractorMatch.rate), source: "SUPPLIER_SPECIFIC", rateCardId: contractorMatch.id };
  }

  const operationDefaults = await PieceRateCardRepository.findActiveForResolution(params.companyId, {
    productionOperationId: params.productionOperationId,
    productId: null,
    employeeId: null,
    employeeCategoryId: null,
    contractorId: null,
  });
  const operationMatch = operationDefaults.filter(activeAt)[0];
  if (operationMatch) {
    return { resolved: true, rate: Number(operationMatch.rate), source: "OPERATION_DEFAULT", rateCardId: operationMatch.id };
  }

  return { resolved: false };
}

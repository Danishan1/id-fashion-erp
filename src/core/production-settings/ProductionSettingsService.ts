import { prisma } from "@/core/db/client";
import type { ExternalEntrySource, PieceRatePaymentQuantityRule } from "@prisma/client";

export interface ProductionSettingsValue {
  supervisorApprovalRequired: boolean;
  externalEntryBy: ExternalEntrySource;
  pieceRateTrackingEnabled: boolean;
  pieceRatePaymentQuantityRule: PieceRatePaymentQuantityRule;
  workersCanViewOwnRate: boolean;
}

const DEFAULT_SETTINGS: ProductionSettingsValue = {
  supervisorApprovalRequired: false,
  externalEntryBy: "INTERNAL_SUPERVISOR",
  pieceRateTrackingEnabled: false,
  pieceRatePaymentQuantityRule: "QC_ACCEPTED_QTY",
  workersCanViewOwnRate: false,
};

/**
 * Company-wide Production behavior toggles — a missing row means the
 * defaults above, matching ActionDisplaySettings' own "single flat row, no
 * backfill" precedent exactly.
 */
export async function getProductionSettings(companyId: string): Promise<ProductionSettingsValue> {
  const row = await prisma.productionSettings.findUnique({ where: { companyId } });
  return {
    supervisorApprovalRequired: row?.supervisorApprovalRequired ?? DEFAULT_SETTINGS.supervisorApprovalRequired,
    externalEntryBy: row?.externalEntryBy ?? DEFAULT_SETTINGS.externalEntryBy,
    pieceRateTrackingEnabled: row?.pieceRateTrackingEnabled ?? DEFAULT_SETTINGS.pieceRateTrackingEnabled,
    pieceRatePaymentQuantityRule: row?.pieceRatePaymentQuantityRule ?? DEFAULT_SETTINGS.pieceRatePaymentQuantityRule,
    workersCanViewOwnRate: row?.workersCanViewOwnRate ?? DEFAULT_SETTINGS.workersCanViewOwnRate,
  };
}

export async function setProductionSettings(
  companyId: string,
  input: Partial<ProductionSettingsValue>
): Promise<ProductionSettingsValue> {
  const current = await getProductionSettings(companyId);
  const merged: ProductionSettingsValue = {
    supervisorApprovalRequired: input.supervisorApprovalRequired ?? current.supervisorApprovalRequired,
    externalEntryBy: input.externalEntryBy ?? current.externalEntryBy,
    pieceRateTrackingEnabled: input.pieceRateTrackingEnabled ?? current.pieceRateTrackingEnabled,
    pieceRatePaymentQuantityRule: input.pieceRatePaymentQuantityRule ?? current.pieceRatePaymentQuantityRule,
    workersCanViewOwnRate: input.workersCanViewOwnRate ?? current.workersCanViewOwnRate,
  };

  const row = await prisma.productionSettings.upsert({
    where: { companyId },
    update: merged,
    create: { companyId, ...merged },
  });

  return {
    supervisorApprovalRequired: row.supervisorApprovalRequired,
    externalEntryBy: row.externalEntryBy,
    pieceRateTrackingEnabled: row.pieceRateTrackingEnabled,
    pieceRatePaymentQuantityRule: row.pieceRatePaymentQuantityRule,
    workersCanViewOwnRate: row.workersCanViewOwnRate,
  };
}

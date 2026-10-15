import { prisma } from "@/core/db/client";

export interface FgInventoryAdjustmentSettingsValue {
  adjustmentApprovalRequired: boolean;
  adjustmentApprovalThresholdQty: number | null;
  adjustmentApprovalThresholdPercent: number | null;
}

const DEFAULT_SETTINGS: FgInventoryAdjustmentSettingsValue = {
  adjustmentApprovalRequired: false,
  adjustmentApprovalThresholdQty: null,
  adjustmentApprovalThresholdPercent: null,
};

/**
 * Company-wide Finished Goods Stock Adjustment approval-gate toggles -- a
 * missing row means the defaults above, matching DispatchSettings'/
 * ProductionSettings' own "single flat row, no backfill" precedent exactly.
 * Deliberately Finished-Goods-only (FGI-032, per explicit confirmed
 * decision) -- the existing raw-material Stock Adjustment flow has no
 * approval concept at all and stays completely untouched.
 */
export async function getFgInventorySettings(companyId: string): Promise<FgInventoryAdjustmentSettingsValue> {
  const row = await prisma.fgInventorySettings.findUnique({ where: { companyId } });
  return {
    adjustmentApprovalRequired: row?.adjustmentApprovalRequired ?? DEFAULT_SETTINGS.adjustmentApprovalRequired,
    adjustmentApprovalThresholdQty: row?.adjustmentApprovalThresholdQty ?? DEFAULT_SETTINGS.adjustmentApprovalThresholdQty,
    adjustmentApprovalThresholdPercent:
      row?.adjustmentApprovalThresholdPercent != null
        ? Number(row.adjustmentApprovalThresholdPercent)
        : DEFAULT_SETTINGS.adjustmentApprovalThresholdPercent,
  };
}

export async function setFgInventorySettings(
  companyId: string,
  input: Partial<FgInventoryAdjustmentSettingsValue>
): Promise<FgInventoryAdjustmentSettingsValue> {
  const current = await getFgInventorySettings(companyId);
  const merged: FgInventoryAdjustmentSettingsValue = {
    adjustmentApprovalRequired: input.adjustmentApprovalRequired ?? current.adjustmentApprovalRequired,
    adjustmentApprovalThresholdQty:
      input.adjustmentApprovalThresholdQty !== undefined ? input.adjustmentApprovalThresholdQty : current.adjustmentApprovalThresholdQty,
    adjustmentApprovalThresholdPercent:
      input.adjustmentApprovalThresholdPercent !== undefined
        ? input.adjustmentApprovalThresholdPercent
        : current.adjustmentApprovalThresholdPercent,
  };

  const row = await prisma.fgInventorySettings.upsert({
    where: { companyId },
    update: merged,
    create: { companyId, ...merged },
  });

  return {
    adjustmentApprovalRequired: row.adjustmentApprovalRequired,
    adjustmentApprovalThresholdQty: row.adjustmentApprovalThresholdQty,
    adjustmentApprovalThresholdPercent: row.adjustmentApprovalThresholdPercent != null ? Number(row.adjustmentApprovalThresholdPercent) : null,
  };
}

/**
 * True whenever a Finished Goods Stock Adjustment document requires a
 * distinct approval sign-off before it can be posted -- mirrors
 * extraDispatchNeedsApproval()'s own exact shape (pure, no I/O, takes
 * already-fetched settings + the document's own real totals). Checked PER
 * LINE rather than as one document-level aggregate, unlike Dispatch's own
 * regular+extra split (which shares one natural document-level total) --
 * each Adjustment line has its own distinct "current available balance"
 * denominator, so a percent-of-balance threshold can only be evaluated per
 * line; summing unrelated variants/products together before comparing
 * against one threshold would be meaningless. If the company-wide
 * adjustmentApprovalRequired flag is set, or ANY single line crosses either
 * threshold, the WHOLE document requires approval.
 */
export function adjustmentNeedsApproval(
  settings: FgInventoryAdjustmentSettingsValue,
  lines: { quantity: number; currentAvailable: number }[]
): boolean {
  const hasAnyAdjustment = lines.some((line) => line.quantity !== 0);
  if (!hasAnyAdjustment) return false;
  if (settings.adjustmentApprovalRequired) return true;

  for (const line of lines) {
    const absQty = Math.abs(line.quantity);
    if (absQty <= 0) continue;
    if (settings.adjustmentApprovalThresholdQty != null && absQty > settings.adjustmentApprovalThresholdQty) {
      return true;
    }
    if (settings.adjustmentApprovalThresholdPercent != null) {
      const percent = line.currentAvailable > 0 ? (absQty / line.currentAvailable) * 100 : 100;
      if (percent > settings.adjustmentApprovalThresholdPercent) return true;
    }
  }
  return false;
}

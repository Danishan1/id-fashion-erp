import { prisma } from "@/core/db/client";

export interface DispatchSettingsValue {
  allowExtraDispatch: boolean;
  extraDispatchApprovalRequired: boolean;
  extraDispatchApprovalThresholdQty: number | null;
  extraDispatchApprovalThresholdPercent: number | null;
}

const DEFAULT_SETTINGS: DispatchSettingsValue = {
  allowExtraDispatch: true,
  extraDispatchApprovalRequired: false,
  extraDispatchApprovalThresholdQty: null,
  extraDispatchApprovalThresholdPercent: null,
};

/**
 * Company-wide Extra Dispatch Quantity behavior toggles — a missing row
 * means the defaults above, matching ProductionSettings'/ActionDisplaySettings'
 * own "single flat row, no backfill" precedent exactly.
 */
export async function getDispatchSettings(companyId: string): Promise<DispatchSettingsValue> {
  const row = await prisma.dispatchSettings.findUnique({ where: { companyId } });
  return {
    allowExtraDispatch: row?.allowExtraDispatch ?? DEFAULT_SETTINGS.allowExtraDispatch,
    extraDispatchApprovalRequired: row?.extraDispatchApprovalRequired ?? DEFAULT_SETTINGS.extraDispatchApprovalRequired,
    extraDispatchApprovalThresholdQty: row?.extraDispatchApprovalThresholdQty ?? DEFAULT_SETTINGS.extraDispatchApprovalThresholdQty,
    extraDispatchApprovalThresholdPercent: row?.extraDispatchApprovalThresholdPercent != null
      ? Number(row.extraDispatchApprovalThresholdPercent)
      : DEFAULT_SETTINGS.extraDispatchApprovalThresholdPercent,
  };
}

export async function setDispatchSettings(
  companyId: string,
  input: Partial<DispatchSettingsValue>
): Promise<DispatchSettingsValue> {
  const current = await getDispatchSettings(companyId);
  const merged: DispatchSettingsValue = {
    allowExtraDispatch: input.allowExtraDispatch ?? current.allowExtraDispatch,
    extraDispatchApprovalRequired: input.extraDispatchApprovalRequired ?? current.extraDispatchApprovalRequired,
    extraDispatchApprovalThresholdQty:
      input.extraDispatchApprovalThresholdQty !== undefined ? input.extraDispatchApprovalThresholdQty : current.extraDispatchApprovalThresholdQty,
    extraDispatchApprovalThresholdPercent:
      input.extraDispatchApprovalThresholdPercent !== undefined
        ? input.extraDispatchApprovalThresholdPercent
        : current.extraDispatchApprovalThresholdPercent,
  };

  const row = await prisma.dispatchSettings.upsert({
    where: { companyId },
    update: merged,
    create: { companyId, ...merged },
  });

  return {
    allowExtraDispatch: row.allowExtraDispatch,
    extraDispatchApprovalRequired: row.extraDispatchApprovalRequired,
    extraDispatchApprovalThresholdQty: row.extraDispatchApprovalThresholdQty,
    extraDispatchApprovalThresholdPercent: row.extraDispatchApprovalThresholdPercent != null ? Number(row.extraDispatchApprovalThresholdPercent) : null,
  };
}

/**
 * True whenever this dispatch's own extra quantity requires a distinct
 * approval sign-off before it can be confirmed — either the company always
 * requires it, or either configured threshold is exceeded. Pure, no I/O —
 * takes the already-fetched settings and the dispatch's own totals.
 */
export function extraDispatchNeedsApproval(
  settings: DispatchSettingsValue,
  totals: { totalRegular: number; totalExtra: number }
): boolean {
  if (totals.totalExtra <= 0) return false;
  if (settings.extraDispatchApprovalRequired) return true;

  if (settings.extraDispatchApprovalThresholdQty != null && totals.totalExtra > settings.extraDispatchApprovalThresholdQty) {
    return true;
  }

  if (settings.extraDispatchApprovalThresholdPercent != null) {
    const totalQty = totals.totalRegular + totals.totalExtra;
    const extraPercent = totalQty > 0 ? (totals.totalExtra / totalQty) * 100 : 0;
    if (extraPercent > settings.extraDispatchApprovalThresholdPercent) return true;
  }

  return false;
}

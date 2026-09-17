import { prisma } from "@/core/db/client";
import type { ActionDisplayMode, ActionTextStyle } from "@prisma/client";

export interface ActionDisplaySettingsValue {
  displayMode: ActionDisplayMode;
  textStyle: ActionTextStyle;
}

const DEFAULT_SETTINGS: ActionDisplaySettingsValue = { displayMode: "ICON", textStyle: "LINK" };

/**
 * Company-wide, Super-Admin-controlled setting for how row actions render
 * across the whole app (icon-only vs. a text label, and if text, a plain
 * link vs. a bordered button) — read by the shared RowAction component via
 * GET /api/v1/action-display-settings. A missing row means the default
 * above, matching AiDesignerSettings' own "single flat row, no backfill"
 * precedent exactly.
 */
export async function getActionDisplaySettings(companyId: string): Promise<ActionDisplaySettingsValue> {
  const row = await prisma.actionDisplaySettings.findUnique({ where: { companyId } });
  return {
    displayMode: row?.displayMode ?? DEFAULT_SETTINGS.displayMode,
    textStyle: row?.textStyle ?? DEFAULT_SETTINGS.textStyle,
  };
}

export async function setActionDisplaySettings(
  companyId: string,
  input: Partial<ActionDisplaySettingsValue>
): Promise<ActionDisplaySettingsValue> {
  const current = await getActionDisplaySettings(companyId);
  const displayMode = input.displayMode ?? current.displayMode;
  const textStyle = input.textStyle ?? current.textStyle;

  const row = await prisma.actionDisplaySettings.upsert({
    where: { companyId },
    update: { displayMode, textStyle },
    create: { companyId, displayMode, textStyle },
  });
  return { displayMode: row.displayMode, textStyle: row.textStyle };
}

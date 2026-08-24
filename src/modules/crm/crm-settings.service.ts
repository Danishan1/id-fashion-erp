import { writeAuditLog } from "@/core/audit/AuditLogger";
import { CrmSettingsRepository } from "./crm-settings.repository";
import type { UpdateCrmSettingsInput } from "./crm-settings.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

export interface LeadPriorityThresholds {
  hotThreshold: number;
  warmThreshold: number;
}

/** The same 80/50 pair `computeLeadPriority()` used to hardcode — now just
 * the fallback for a company that has never customized these. */
export const DEFAULT_LEAD_PRIORITY_THRESHOLDS: LeadPriorityThresholds = { hotThreshold: 80, warmThreshold: 50 };

/** No row yet means "still on the defaults" — same lazy-create-on-first-edit
 * precedent as this project's document sequences, not something every
 * company needs seeded upfront. */
export async function getCrmSettings(companyId: string): Promise<LeadPriorityThresholds> {
  const existing = await CrmSettingsRepository.findByCompany(companyId);
  if (!existing) return DEFAULT_LEAD_PRIORITY_THRESHOLDS;
  return { hotThreshold: Number(existing.hotThreshold), warmThreshold: Number(existing.warmThreshold) };
}

export async function updateCrmSettings(actor: ActorContext, input: UpdateCrmSettingsInput) {
  const before = await getCrmSettings(actor.companyId);

  const updated = await CrmSettingsRepository.upsert(actor.companyId, {
    hotThreshold: input.hotThreshold,
    warmThreshold: input.warmThreshold,
    updatedByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_settings",
    recordId: updated.id,
    action: "UPDATE",
    oldValues: { ...before },
    newValues: { hotThreshold: input.hotThreshold, warmThreshold: input.warmThreshold },
  });

  return { hotThreshold: Number(updated.hotThreshold), warmThreshold: Number(updated.warmThreshold) };
}

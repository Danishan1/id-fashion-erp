import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { CompanySettingsRepository } from "./company-settings.repository";
import type { CompanySettingsInput } from "./company-settings.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
}

export async function getCompanySettings(companyId: string) {
  const company = await CompanySettingsRepository.findById(companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: companyId });
  return company;
}

export async function updateCompanySettings(actor: ActorContext, input: CompanySettingsInput) {
  const existing = await getCompanySettings(actor.companyId);

  const updated = await CompanySettingsRepository.update(actor.companyId, {
    name: input.name,
    legalName: input.legalName || null,
    taxRegistrationNo: input.taxRegistrationNo || null,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    addressJson: input.addressLine ? { line1: input.addressLine } : undefined,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "companies",
    recordId: actor.companyId,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });

  return updated;
}

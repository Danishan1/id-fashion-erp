import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { emailKey, nameKey, phoneKey, uniqueKeys } from "../core/crm-normalize";
import type { LeadDuplicateAction, LeadDuplicateRule, LeadDuplicateRuleKey } from "../settings/crm-defaults";
import { getLeadDuplicateRules } from "../settings/crm-settings.service";
import { LeadRepository } from "./lead.repository";

export interface LeadContactKeys {
  emailKeys: string[];
  phoneKeys: string[];
  companyNameKey: string;
}

export function leadContactKeys(input: {
  email?: string | null;
  alternateEmail?: string | null;
  phone?: string | null;
  mobile?: string | null;
  whatsapp?: string | null;
  companyName?: string | null;
}): LeadContactKeys {
  return {
    emailKeys: uniqueKeys([emailKey(input.email), emailKey(input.alternateEmail)]),
    phoneKeys: uniqueKeys([phoneKey(input.phone), phoneKey(input.mobile), phoneKey(input.whatsapp)]),
    companyNameKey: nameKey(input.companyName),
  };
}

export interface LeadDuplicateMatch {
  id: string;
  leadNumber: string;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  owner: string | null;
  archived: boolean;
  /** Which configured rules this lead matched, and the strictest action. */
  rules: LeadDuplicateRuleKey[];
  action: Exclude<LeadDuplicateAction, "OFF">;
}

export interface LeadDuplicateResult {
  matches: LeadDuplicateMatch[];
  /** True when at least one match is under a BLOCK rule. */
  blocking: boolean;
}

/**
 * Applies the company's configured duplicate rules (EMAIL, PHONE,
 * COMPANY_AND_EMAIL, COMPANY_AND_PHONE; each WARN / BLOCK / OFF). Candidates
 * come from one indexed query on the normalised email/phone keys; rules are
 * then evaluated per candidate. Archived leads still count as duplicates
 * (they are flagged so the UI can say so).
 */
export async function findLeadDuplicates(companyId: string, keys: LeadContactKeys, excludeLeadId?: string, rules?: LeadDuplicateRule[]): Promise<LeadDuplicateResult> {
  const active = (rules ?? (await getLeadDuplicateRules(companyId))).filter((r) => r.action !== "OFF");
  if (!active.length) return { matches: [], blocking: false };
  const candidates = await LeadRepository.findMatches(companyId, keys.emailKeys, keys.phoneKeys, excludeLeadId);

  const matches: LeadDuplicateMatch[] = [];
  for (const c of candidates) {
    const sameEmail = c.emailKeys.some((k) => keys.emailKeys.includes(k));
    const samePhone = c.phoneKeys.some((k) => keys.phoneKeys.includes(k));
    const sameCompany = Boolean(keys.companyNameKey) && nameKey(c.companyName) === keys.companyNameKey;
    const hit = active.filter(
      (r) =>
        (r.rule === "EMAIL" && sameEmail) ||
        (r.rule === "PHONE" && samePhone) ||
        (r.rule === "COMPANY_AND_EMAIL" && sameCompany && sameEmail) ||
        (r.rule === "COMPANY_AND_PHONE" && sameCompany && samePhone)
    );
    if (!hit.length) continue;
    matches.push({
      id: c.id,
      leadNumber: c.leadNumber,
      fullName: c.fullName,
      companyName: c.companyName,
      email: c.email,
      phone: c.phone ?? c.mobile ?? c.whatsapp,
      status: c.status.name,
      owner: c.owner?.fullName ?? null,
      archived: c.archivedAt !== null,
      rules: hit.map((r) => r.rule),
      action: hit.some((r) => r.action === "BLOCK") ? "BLOCK" : "WARN",
    });
  }
  return { matches, blocking: matches.some((m) => m.action === "BLOCK") };
}

/** Throws when the configured rules say this save must not go ahead silently. */
export function assertNoBlockingDuplicates(result: LeadDuplicateResult, confirmDuplicate: boolean | undefined) {
  if (result.blocking) {
    throw new BusinessRuleError("DUPLICATE_LEAD_EXISTS", "A lead with the same details already exists. Open the existing lead instead.", {
      matches: result.matches,
    });
  }
  if (result.matches.length && !confirmDuplicate) {
    throw new BusinessRuleError("CRM_POSSIBLE_DUPLICATE", "Possible duplicate found. Review the existing lead or confirm to save anyway.", {
      matches: result.matches,
    });
  }
}

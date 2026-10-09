import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { phoneKey } from "../core/crm-normalize";
import { getContactDuplicateRules } from "../settings/crm-settings.service";
import type { ContactDuplicateAction, ContactDuplicateRule, ContactDuplicateRuleKey } from "./contact-registry";
import { CrmContactRepository, type ContactDuplicateCandidate } from "./crm-contact.repository";

/** What is compared for one contact being saved. */
export interface ContactDuplicateKeys {
  emailKeys: string[];
  phoneKey: string | null;
  mobileKey: string | null;
  whatsappKey: string | null;
  nameKey: string;
  crmCompanyId: string | null;
}

export function contactDuplicateKeys(input: {
  emailKeys: string[];
  phone?: string | null;
  mobile?: string | null;
  whatsapp?: string | null;
  nameKey: string;
  crmCompanyId?: string | null;
}): ContactDuplicateKeys {
  return {
    emailKeys: input.emailKeys,
    phoneKey: phoneKey(input.phone),
    mobileKey: phoneKey(input.mobile),
    whatsappKey: phoneKey(input.whatsapp),
    nameKey: input.nameKey,
    crmCompanyId: input.crmCompanyId || null,
  };
}

export interface ContactDuplicateMatch {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  owner: string | null;
  archived: boolean;
  ownerUserId: string | null;
  createdByUserId: string;
  rules: ContactDuplicateRuleKey[];
  action: Exclude<ContactDuplicateAction, "OFF">;
}

export interface ContactDuplicateResult {
  matches: ContactDuplicateMatch[];
  /** At least one match is under a BLOCK rule. */
  blocking: boolean;
  /** At least one match is under a WARN rule (needs confirmation). */
  needsConfirmation: boolean;
  /** Ids matched only by FLAG rules — saved, then marked for review. */
  flaggedIds: string[];
}

const SEVERITY: Record<Exclude<ContactDuplicateAction, "OFF">, number> = { FLAG: 1, WARN: 2, BLOCK: 3 };

/** Pure rule evaluation over already-fetched candidates. */
export function evaluateContactCandidates(candidates: ContactDuplicateCandidate[], keys: ContactDuplicateKeys, rules: ContactDuplicateRule[]): ContactDuplicateResult {
  const active = rules.filter((r) => r.action !== "OFF");
  const matches: ContactDuplicateMatch[] = [];
  for (const c of candidates) {
    const sameEmail = c.emailKeys.some((k) => keys.emailKeys.includes(k));
    const sameName = Boolean(keys.nameKey) && c.nameKey === keys.nameKey;
    const has = (k: string | null) => Boolean(k) && c.phoneKeys.includes(k as string);
    const hit = active.filter(
      (r) =>
        (r.rule === "EMAIL" && sameEmail) ||
        (r.rule === "PHONE" && has(keys.phoneKey)) ||
        (r.rule === "MOBILE" && has(keys.mobileKey)) ||
        (r.rule === "WHATSAPP" && has(keys.whatsappKey)) ||
        (r.rule === "NAME_AND_COMPANY" && sameName && Boolean(keys.crmCompanyId) && c.crmCompanyId === keys.crmCompanyId) ||
        (r.rule === "NAME_AND_EMAIL" && sameName && sameEmail)
    );
    if (!hit.length) continue;
    const action = hit.reduce<Exclude<ContactDuplicateAction, "OFF">>((acc, r) => {
      const a = r.action as Exclude<ContactDuplicateAction, "OFF">;
      return SEVERITY[a] > SEVERITY[acc] ? a : acc;
    }, "FLAG");
    matches.push({
      id: c.id,
      fullName: c.fullName,
      companyName: c.crmCompany?.name ?? null,
      email: c.email,
      phone: c.mobile ?? c.phone ?? c.whatsapp,
      owner: c.owner?.fullName ?? null,
      archived: c.archivedAt !== null,
      ownerUserId: c.ownerUserId,
      createdByUserId: c.createdByUserId,
      rules: hit.map((r) => r.rule),
      action,
    });
  }
  return {
    matches,
    blocking: matches.some((m) => m.action === "BLOCK"),
    needsConfirmation: matches.some((m) => m.action === "WARN"),
    flaggedIds: matches.filter((m) => m.action === "FLAG").map((m) => m.id),
  };
}

/**
 * Applies the company's contact duplicate rules. Candidates come from one
 * indexed query (email/phone GIN keys, or name key + company); merged
 * contacts never count, archived ones do (flagged as archived).
 */
export async function findContactDuplicates(companyId: string, keys: ContactDuplicateKeys, excludeId?: string, rules?: ContactDuplicateRule[]): Promise<ContactDuplicateResult> {
  const active = (rules ?? (await getContactDuplicateRules(companyId))).filter((r) => r.action !== "OFF");
  if (!active.length) return { matches: [], blocking: false, needsConfirmation: false, flaggedIds: [] };
  const phoneRuleKeys = [
    active.some((r) => r.rule === "PHONE") ? keys.phoneKey : null,
    active.some((r) => r.rule === "MOBILE") ? keys.mobileKey : null,
    active.some((r) => r.rule === "WHATSAPP") ? keys.whatsappKey : null,
  ].filter((k): k is string => Boolean(k));
  const wantsEmail = active.some((r) => r.rule === "EMAIL" || r.rule === "NAME_AND_EMAIL");
  const wantsName = active.some((r) => r.rule === "NAME_AND_COMPANY");
  const candidates = await CrmContactRepository.duplicateCandidates(
    companyId,
    { emailKeys: wantsEmail ? keys.emailKeys : [], phoneKeys: [...new Set(phoneRuleKeys)], nameKey: wantsName ? keys.nameKey : null, crmCompanyId: wantsName ? keys.crmCompanyId : null },
    excludeId
  );
  return evaluateContactCandidates(candidates, keys, active);
}

/**
 * Enforces the result of a duplicate check on save:
 *   BLOCK → always refused (link or merge with the existing contact instead)
 *   WARN  → refused until the user confirms
 *   FLAG  → allowed; the caller marks the new contact for review
 * `code` lets lead conversion keep its Phase 02 error contract.
 */
export function assertContactDuplicatesAllowed(result: ContactDuplicateResult, confirmed: boolean | undefined, code: "CRM_POSSIBLE_DUPLICATE" | "CRM_DUPLICATE_RECORD" = "CRM_POSSIBLE_DUPLICATE") {
  if (result.blocking) {
    throw new BusinessRuleError("CRM_DUPLICATE_RECORD", "A contact with these details already exists, and your duplicate rules don't allow another. Open or link the existing contact instead.", {
      entityType: "CONTACT",
      blocking: true,
      matches: result.matches,
    });
  }
  if (result.needsConfirmation && !confirmed) {
    throw new BusinessRuleError(
      code,
      code === "CRM_DUPLICATE_RECORD"
        ? `A contact with the same details already exists (${result.matches[0].fullName}). Link it instead, or confirm to create another.`
        : "Possible duplicate contact found. Review the existing contact or confirm to save anyway.",
      { entityType: "CONTACT", blocking: false, matches: result.matches }
    );
  }
}

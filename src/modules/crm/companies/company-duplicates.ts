import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getCompanyDuplicateRules } from "../settings/crm-settings.service";
import type { CompanyDuplicateAction, CompanyDuplicateRule, CompanyDuplicateRuleKey } from "./company-registry";
import { CrmCompanyRepository, type CompanyDuplicateCandidate } from "./crm-company.repository";

/** What is compared for one company being saved. */
export interface CompanyDuplicateKeys {
  nameMatchKey: string;
  legalMatchKey: string | null;
  websiteKey: string | null;
  emailKeys: string[];
  phoneKeys: string[];
  customerId: string | null;
}

/** ERP_CUSTOMER is not configurable: one ERP customer ↔ one CRM company (unique key). */
export type CompanyMatchRule = CompanyDuplicateRuleKey | "ERP_CUSTOMER";

export interface CompanyDuplicateMatch {
  id: string;
  name: string;
  legalName: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  owner: string | null;
  customer: { code: string; name: string } | null;
  archived: boolean;
  ownerUserId: string | null;
  createdByUserId: string;
  rules: CompanyMatchRule[];
  action: Exclude<CompanyDuplicateAction, "OFF">;
}

export interface CompanyDuplicateResult {
  matches: CompanyDuplicateMatch[];
  blocking: boolean;
  needsConfirmation: boolean;
  /** Ids matched only by FLAG rules — saved, then marked for review. */
  flaggedIds: string[];
}

const SEVERITY: Record<Exclude<CompanyDuplicateAction, "OFF">, number> = { FLAG: 1, WARN: 2, BLOCK: 3 };
const EMPTY: CompanyDuplicateResult = { matches: [], blocking: false, needsConfirmation: false, flaggedIds: [] };

/** Pure rule evaluation over already-fetched candidates; several matching signals are all reported. */
export function evaluateCompanyCandidates(candidates: CompanyDuplicateCandidate[], keys: CompanyDuplicateKeys, rules: CompanyDuplicateRule[]): CompanyDuplicateResult {
  const active = rules.filter((r) => r.action !== "OFF");
  const matches: CompanyDuplicateMatch[] = [];
  for (const c of candidates) {
    const signals: CompanyMatchRule[] = [];
    if (keys.nameMatchKey && c.nameMatchKey === keys.nameMatchKey) signals.push("NAME");
    const legalPairs = [
      [keys.legalMatchKey, c.legalMatchKey],
      [keys.legalMatchKey, c.nameMatchKey],
      [keys.nameMatchKey, c.legalMatchKey],
    ];
    if (legalPairs.some(([a, b]) => a && b && a === b)) signals.push("LEGAL_NAME");
    if (keys.websiteKey && c.websiteKey === keys.websiteKey) signals.push("WEBSITE");
    if (c.emailKeys.some((k) => keys.emailKeys.includes(k))) signals.push("EMAIL");
    if (c.phoneKeys.some((k) => keys.phoneKeys.includes(k))) signals.push("PHONE");
    const erp = Boolean(keys.customerId) && c.customerId === keys.customerId;

    const hit = active.filter((r) => signals.includes(r.rule));
    if (!hit.length && !erp) continue;
    let action = hit.reduce<Exclude<CompanyDuplicateAction, "OFF">>((acc, r) => {
      const a = r.action as Exclude<CompanyDuplicateAction, "OFF">;
      return SEVERITY[a] > SEVERITY[acc] ? a : acc;
    }, "FLAG");
    if (erp) action = "BLOCK";
    matches.push({
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      website: c.website,
      email: c.email,
      phone: c.phone ?? c.mobile,
      city: c.city,
      owner: c.owner?.fullName ?? null,
      customer: c.customer ? { code: c.customer.code, name: c.customer.name } : null,
      archived: c.archivedAt !== null,
      ownerUserId: c.ownerUserId,
      createdByUserId: c.createdByUserId,
      rules: [...(erp ? (["ERP_CUSTOMER"] as const) : []), ...hit.map((r) => r.rule)],
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
 * Applies the company duplicate rules with one indexed candidate query.
 * Merged companies never count; archived ones do (labelled archived).
 */
export async function findCompanyDuplicates(companyId: string, keys: CompanyDuplicateKeys, excludeId?: string, rules?: CompanyDuplicateRule[]): Promise<CompanyDuplicateResult> {
  const active = (rules ?? (await getCompanyDuplicateRules(companyId))).filter((r) => r.action !== "OFF");
  const on = (r: CompanyDuplicateRuleKey) => active.some((x) => x.rule === r);
  const nameKeys = [...new Set([on("NAME") || on("LEGAL_NAME") ? keys.nameMatchKey : null, on("LEGAL_NAME") ? keys.legalMatchKey : null].filter((k): k is string => Boolean(k)))];
  const criteria = {
    nameKeys,
    legalKeys: on("LEGAL_NAME") ? nameKeys : [],
    websiteKey: on("WEBSITE") ? keys.websiteKey : null,
    emailKeys: on("EMAIL") ? keys.emailKeys : [],
    phoneKeys: on("PHONE") ? keys.phoneKeys : [],
    customerId: keys.customerId,
  };
  if (!criteria.nameKeys.length && !criteria.websiteKey && !criteria.emailKeys.length && !criteria.phoneKeys.length && !criteria.customerId) return EMPTY;
  const candidates = await CrmCompanyRepository.duplicateCandidates(companyId, criteria, excludeId);
  return evaluateCompanyCandidates(candidates, keys, active);
}

/**
 * BLOCK (incl. same ERP customer) → refused; WARN → refused until confirmed;
 * FLAG → allowed and marked by the caller. `code` keeps the lead-conversion contract.
 */
export function assertCompanyDuplicatesAllowed(result: CompanyDuplicateResult, confirmed: boolean | undefined, code: "CRM_POSSIBLE_DUPLICATE" | "CRM_DUPLICATE_RECORD" = "CRM_POSSIBLE_DUPLICATE") {
  if (result.blocking) {
    const erp = result.matches.find((m) => m.rules.includes("ERP_CUSTOMER"));
    throw new BusinessRuleError(
      "CRM_DUPLICATE_RECORD",
      erp ? `This ERP customer is already linked to the CRM company "${erp.name}".` : "A company with these details already exists, and your duplicate rules don't allow another. Open or link the existing company instead.",
      { entityType: "COMPANY", blocking: true, matches: result.matches }
    );
  }
  if (result.needsConfirmation && !confirmed) {
    throw new BusinessRuleError(
      code,
      code === "CRM_DUPLICATE_RECORD"
        ? `A company with the same details already exists (${result.matches[0].name}). Link it instead, or confirm to create another.`
        : "Possible duplicate company found. Review the existing company or confirm to save anyway.",
      { entityType: "COMPANY", blocking: false, matches: result.matches }
    );
  }
}

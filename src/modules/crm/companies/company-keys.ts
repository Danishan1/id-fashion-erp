import { buildSearchText, emailKey, nameKey, phoneKey, uniqueKeys } from "../core/crm-normalize";

/**
 * Pure derivations stored on every CRM company so duplicate checks and
 * search are single indexed queries. `companyMatchKey` must stay identical to
 * the SQL back-fill in migration 20261004100000_crm_companies.
 */

const LEGAL_SUFFIXES = /( (pvt|private|ltd|limited|llp|llc|inc|co|corp|corporation|company|gmbh|plc))+$/;

/** "The ABC Exports Pvt. Ltd." → "abc exports"; "Müller & Söhne GmbH" → "müller and söhne". */
export function companyMatchKey(value: string | null | undefined): string {
  let k = (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  k = k.replace(/^the /, "").replace(LEGAL_SUFFIXES, "");
  return k.replace(/\s+/g, " ").trim();
}

/** "https://www.ABC.com/about" → "abc.com"; null when blank. */
export function websiteKey(value: string | null | undefined): string | null {
  const k = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/[/?#:].*$/, "");
  return k || null;
}

/** Normalises what people type into a link (adds https://). Returns null for blanks; throws on nonsense. */
export function normaliseWebsite(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  if (!u.hostname.includes(".")) throw new Error("invalid host");
  return u.toString().replace(/\/$/, "");
}

export interface CompanyCore {
  name: string;
  legalName?: string | null;
  displayName?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  industry?: string | null;
  companyType?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export function companyDerivedFields(c: CompanyCore, customer?: { code: string; name: string } | null) {
  return {
    nameKey: nameKey(c.name),
    nameMatchKey: companyMatchKey(c.name),
    legalMatchKey: c.legalName ? companyMatchKey(c.legalName) || null : null,
    websiteKey: websiteKey(c.website),
    emailKeys: uniqueKeys([emailKey(c.email)]),
    phoneKeys: uniqueKeys([phoneKey(c.phone), phoneKey(c.mobile)]),
    searchText: buildSearchText([
      c.name,
      c.legalName,
      c.displayName,
      c.website,
      c.email,
      c.phone,
      c.mobile,
      c.industry,
      c.companyType,
      c.city,
      c.state,
      c.country,
      customer?.code,
      customer?.name,
    ]),
  };
}

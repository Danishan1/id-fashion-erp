import { buildSearchText, emailKey, fullNameOf, nameKey, phoneKey, uniqueKeys } from "../core/crm-normalize";
import { CONTACT_CHANNEL_TYPES, type ContactChannelType } from "./contact-registry";

/**
 * Pure derivations kept on every contact row so duplicate checks and search
 * are single indexed queries: name key, email/phone match keys (core fields
 * plus extra channels) and the lower-cased search text.
 */
export interface ContactCore {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  department?: string | null;
  email?: string | null;
  alternateEmail?: string | null;
  phone?: string | null;
  mobile?: string | null;
  whatsapp?: string | null;
}

export interface ChannelValue {
  channelType: string;
  value: string;
}

export function contactFullName(c: Pick<ContactCore, "firstName" | "middleName" | "lastName">): string {
  return fullNameOf([c.firstName.trim(), c.middleName?.trim()].filter(Boolean).join(" "), c.lastName);
}

const kindOf = (t: string) => CONTACT_CHANNEL_TYPES[t as ContactChannelType]?.kind ?? "text";

/** Normalised key for one channel value (used for the per-contact unique index). */
export function channelValueKey(channelType: string, value: string): string {
  const kind = kindOf(channelType);
  if (kind === "email") return emailKey(value) ?? "";
  if (kind === "phone") return phoneKey(value) ?? value.replace(/\D/g, "");
  return value.trim().toLowerCase();
}

export function contactMatchKeys(c: ContactCore, channels: ChannelValue[] = []) {
  const extraEmails = channels.filter((ch) => kindOf(ch.channelType) === "email").map((ch) => emailKey(ch.value));
  const extraPhones = channels.filter((ch) => kindOf(ch.channelType) === "phone").map((ch) => phoneKey(ch.value));
  return {
    emailKeys: uniqueKeys([emailKey(c.email), emailKey(c.alternateEmail), ...extraEmails]),
    phoneKeys: uniqueKeys([phoneKey(c.phone), phoneKey(c.mobile), phoneKey(c.whatsapp), ...extraPhones]),
  };
}

export function contactDerivedFields(c: ContactCore, channels: ChannelValue[] = [], companyName?: string | null) {
  const fullName = contactFullName(c);
  return {
    fullName,
    nameKey: nameKey(fullName),
    ...contactMatchKeys(c, channels),
    searchText: buildSearchText([
      fullName,
      c.designation,
      c.department,
      c.email,
      c.alternateEmail,
      c.phone,
      c.mobile,
      c.whatsapp,
      companyName,
      ...channels.map((ch) => ch.value),
    ]),
  };
}

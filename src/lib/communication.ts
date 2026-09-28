// Client-safe link builders for the CRM quick actions (Call / Email /
// WhatsApp). These open the user's own device apps — no API, no credentials.
// Paid/official providers (WhatsApp Business API, an email service, a
// telephony provider) plug in server-side via src/core/communication/.

/** Digits only, as wa.me requires ("+91 98100-12345" → "919810012345"). */
export function toInternationalDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * wa.me needs the full international number. A number typed without a
 * leading "+" or "00" may be a local number whose country code is missing —
 * the caller surfaces that as a warning rather than guessing a country code.
 */
export function hasCountryCode(phone: string | null | undefined): boolean {
  const trimmed = phone?.trim() ?? "";
  return trimmed.startsWith("+") || trimmed.startsWith("00");
}

export function whatsAppUrl(phone: string | null | undefined, message?: string): string | null {
  const digits = toInternationalDigits(phone);
  if (!digits) return null;
  const normalized = digits.startsWith("00") ? digits.slice(2) : digits;
  return `https://wa.me/${normalized}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export function telUrl(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim();
  if (!trimmed) return null;
  return `tel:${trimmed.replace(/[^\d+]/g, "")}`;
}

export function mailtoUrl(email: string | null | undefined, subject?: string): string | null {
  const trimmed = email?.trim();
  if (!trimmed) return null;
  return `mailto:${trimmed}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

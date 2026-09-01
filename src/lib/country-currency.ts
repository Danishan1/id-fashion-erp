import { COUNTRIES } from "@/lib/countries";

/**
 * The real-world default currency for each entry in `COUNTRIES` (ISO 4217), used to
 * auto-select a Currency dropdown's value when a Country dropdown changes. "Other" has
 * no sensible default and is deliberately absent — picking it never forces a currency.
 * The auto-select only actually applies a value if that currency exists in whatever the
 * `/api/v1/currencies` list currently returns (see CustomerForm.tsx) — this map itself
 * makes no assumption about what's seeded.
 */
export const COUNTRY_TO_CURRENCY: Record<(typeof COUNTRIES)[number], string | undefined> = {
  India: "INR",
  USA: "USD",
  "United Kingdom": "GBP",
  Germany: "EUR",
  France: "EUR",
  Italy: "EUR",
  Spain: "EUR",
  Netherlands: "EUR",
  Belgium: "EUR",
  Sweden: "SEK",
  Norway: "NOK",
  Denmark: "DKK",
  Finland: "EUR",
  Switzerland: "CHF",
  Austria: "EUR",
  Poland: "PLN",
  Portugal: "EUR",
  Ireland: "EUR",
  Australia: "AUD",
  "New Zealand": "NZD",
  Canada: "CAD",
  UAE: "AED",
  "Saudi Arabia": "SAR",
  Qatar: "QAR",
  Kuwait: "KWD",
  Oman: "OMR",
  Bahrain: "BHD",
  Japan: "JPY",
  China: "CNY",
  "South Korea": "KRW",
  Singapore: "SGD",
  "Hong Kong": "HKD",
  Malaysia: "MYR",
  Indonesia: "IDR",
  Thailand: "THB",
  Vietnam: "VND",
  Philippines: "PHP",
  Bangladesh: "BDT",
  "Sri Lanka": "LKR",
  Pakistan: "PKR",
  Nepal: "NPR",
  "South Africa": "ZAR",
  Egypt: "EGP",
  Turkey: "TRY",
  Israel: "ILS",
  Brazil: "BRL",
  Mexico: "MXN",
  Argentina: "ARS",
  Chile: "CLP",
  Colombia: "COP",
  Russia: "RUB",
  Other: undefined,
};

export function getDefaultCurrencyForCountry(country: string): string | undefined {
  return COUNTRY_TO_CURRENCY[country as (typeof COUNTRIES)[number]];
}

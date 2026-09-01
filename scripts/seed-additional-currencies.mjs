// One-off, idempotent seed script — adds every currency the new Country→Currency
// auto-select mapping (src/lib/country-currency.ts) needs but prisma/seed.ts never
// seeded (only USD/INR/EUR exist there). Safe to re-run anytime (skipDuplicates).
// Not part of seed.ts itself, per this project's documented "seed.ts isn't safe to
// re-run against a live dev DB" convention — run once via `node scripts/seed-additional-currencies.mjs`.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CURRENCIES = [
  { code: "GBP", name: "British Pound", symbol: "£", decimalPlaces: 2 },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", decimalPlaces: 2 },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", decimalPlaces: 2 },
  { code: "DKK", name: "Danish Krone", symbol: "kr", decimalPlaces: 2 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", decimalPlaces: 2 },
  { code: "PLN", name: "Polish Zloty", symbol: "zł", decimalPlaces: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", decimalPlaces: 2 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", decimalPlaces: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", decimalPlaces: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimalPlaces: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", decimalPlaces: 2 },
  { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق", decimalPlaces: 2 },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك", decimalPlaces: 3 },
  { code: "OMR", name: "Omani Rial", symbol: "ر.ع.", decimalPlaces: 3 },
  { code: "BHD", name: "Bahraini Dinar", symbol: ".د.ب", decimalPlaces: 3 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimalPlaces: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", decimalPlaces: 2 },
  { code: "KRW", name: "South Korean Won", symbol: "₩", decimalPlaces: 0 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimalPlaces: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimalPlaces: 2 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", decimalPlaces: 2 },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", decimalPlaces: 2 },
  { code: "THB", name: "Thai Baht", symbol: "฿", decimalPlaces: 2 },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫", decimalPlaces: 0 },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", decimalPlaces: 2 },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", decimalPlaces: 2 },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", decimalPlaces: 2 },
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", decimalPlaces: 2 },
  { code: "NPR", name: "Nepalese Rupee", symbol: "Rs", decimalPlaces: 2 },
  { code: "ZAR", name: "South African Rand", symbol: "R", decimalPlaces: 2 },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", decimalPlaces: 2 },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", decimalPlaces: 2 },
  { code: "ILS", name: "Israeli New Shekel", symbol: "₪", decimalPlaces: 2 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", decimalPlaces: 2 },
  { code: "MXN", name: "Mexican Peso", symbol: "$", decimalPlaces: 2 },
  { code: "ARS", name: "Argentine Peso", symbol: "$", decimalPlaces: 2 },
  { code: "CLP", name: "Chilean Peso", symbol: "$", decimalPlaces: 0 },
  { code: "COP", name: "Colombian Peso", symbol: "$", decimalPlaces: 2 },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", decimalPlaces: 2 },
];

const result = await prisma.currency.createMany({ data: CURRENCIES, skipDuplicates: true });
console.log(`Inserted ${result.count} new currency rows (existing rows left untouched).`);
await prisma.$disconnect();

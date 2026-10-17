import { NextResponse } from "next/server";
import { requireAnySession, handleApiError } from "@/lib/api-route";
import { prisma } from "@/core/db/client";

const DEFAULT_CURRENCIES = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", decimalPlaces: 2 },
  { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", decimalPlaces: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimalPlaces: 2 },
];

export async function GET() {
  try {
    await requireAnySession();
    let currencies = await prisma.currency.findMany({ orderBy: { code: "asc" } });
    if (currencies.length === 0) {
      await prisma.currency.createMany({
        data: DEFAULT_CURRENCIES,
        skipDuplicates: true,
      }).catch(() => {});
      currencies = await prisma.currency.findMany({ orderBy: { code: "asc" } });
      if (currencies.length === 0) {
        return NextResponse.json({ data: DEFAULT_CURRENCIES });
      }
    }
    return NextResponse.json({ data: currencies });
  } catch (error) {
    return handleApiError(error);
  }
}


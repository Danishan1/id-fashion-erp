import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { prisma } from "@/core/db/client";

export async function GET() {
  try {
    await requireSession();
    const currencies = await prisma.currency.findMany({ orderBy: { code: "asc" } });
    return NextResponse.json({ data: currencies });
  } catch (error) {
    return handleApiError(error);
  }
}

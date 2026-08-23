import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { prisma } from "@/core/db/client";

// Minimal read-only lookup (id + fullName only) for "assigned to"/"requested
// by"-style dropdowns across modules — same pattern as /api/v1/currencies.
// No dedicated Users module/permission exists yet, so this just requires a
// valid session, matching every other simple lookup used purely for filters.
export async function GET() {
  try {
    const session = await requireSession();
    const users = await prisma.user.findMany({
      where: { companyId: session.user.companyId, status: "ACTIVE" },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    });
    return NextResponse.json({ data: users });
  } catch (error) {
    return handleApiError(error);
  }
}

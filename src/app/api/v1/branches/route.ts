import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { prisma } from "@/core/db/client";

// Minimal read-only lookup (id + name) for pickers — same no-module-needed
// pattern as /api/v1/currencies and /api/v1/users.
export async function GET() {
  try {
    const session = await requireSession();
    const branches = await prisma.branch.findMany({
      where: { companyId: session.user.companyId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ data: branches });
  } catch (error) {
    return handleApiError(error);
  }
}

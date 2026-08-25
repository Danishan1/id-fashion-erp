import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { prisma } from "@/core/db/client";

// Minimal read-only lookup (id + name) for the New User role picker — same
// no-module-needed pattern as /api/v1/currencies and /api/v1/branches.
export async function GET() {
  try {
    const session = await requireSession();
    const roles = await prisma.role.findMany({
      where: { companyId: session.user.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ data: roles });
  } catch (error) {
    return handleApiError(error);
  }
}

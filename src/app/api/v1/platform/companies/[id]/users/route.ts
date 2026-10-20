import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { listCompanyUsers } from "@/modules/platform/platform-company-lifecycle.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT", "BILLING_ADMIN"]);
    const { id } = await params;
    const users = await listCompanyUsers(id);
    return NextResponse.json({ data: users });
  } catch (error) {
    return handleApiError(error);
  }
}

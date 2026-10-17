import { NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { activateCompany } from "@/modules/platform/platform-company-lifecycle.service";

/** PLAT-016: reactivate a suspended company. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    await activateCompany({ platformUserId: platformUser.id }, id);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Company reactivated." } });
  } catch (error) {
    return handleApiError(error);
  }
}

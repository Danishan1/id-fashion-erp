import { NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { cancelSupportRequest } from "@/modules/support-access/support-access.service";
import { toPlatformActor } from "@/modules/support-access/support-access.route-helpers";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const { id } = await params;
    await cancelSupportRequest(toPlatformActor(platformUser), id);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Support request cancelled." } });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { createSupportSessionExchangeToken } from "@/modules/support-access/support-access.service";
import { toPlatformActor } from "@/modules/support-access/support-access.route-helpers";

/** PLAT-011: a single-use, 60-second token the browser exchanges for a support-session sign-in. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const { id } = await params;
    const result = await createSupportSessionExchangeToken(toPlatformActor(platformUser), id);
    return NextResponse.json({ data: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

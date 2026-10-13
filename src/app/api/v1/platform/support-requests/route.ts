import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { createSupportRequestSchema } from "@/modules/support-access/support-access.schema";
import { createSupportRequest, listPlatformSupportRequests } from "@/modules/support-access/support-access.service";
import { toPlatformActor } from "@/modules/support-access/support-access.route-helpers";

export async function GET() {
  try {
    const { platformUser } = await requirePlatformSession();
    return NextResponse.json({ data: await listPlatformSupportRequests(toPlatformActor(platformUser)) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PLAT-009: request access to one company. The 6-digit code is returned once. */
export async function POST(req: NextRequest) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const input = createSupportRequestSchema.parse(await req.json());
    const result = await createSupportRequest(toPlatformActor(platformUser), input);
    return NextResponse.json({ data: result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

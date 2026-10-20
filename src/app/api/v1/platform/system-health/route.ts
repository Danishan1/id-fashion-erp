import { NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { checkSystemHealth } from "@/modules/platform/platform-system-health.service";

export async function GET() {
  try {
    await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const report = await checkSystemHealth();
    return NextResponse.json({ data: report });
  } catch (error) {
    return handleApiError(error);
  }
}

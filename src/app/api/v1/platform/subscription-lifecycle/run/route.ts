import { NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { processSubscriptionLifecycle } from "@/modules/platform/subscription-lifecycle.service";

export async function POST() {
  try {
    await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const result = await processSubscriptionLifecycle(new Date());
    return NextResponse.json(
      { data: result },
      { headers: { "x-toast-success": `Processed lifecycle: ${result.sent} notice(s) sent.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

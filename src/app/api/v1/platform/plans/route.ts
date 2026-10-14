import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { subscriptionPlanSchema } from "@/modules/platform/subscription.schema";
import { createSubscriptionPlan, listSubscriptionPlans } from "@/modules/platform/subscription-plan.service";

/** PLAT-022: the subscription plan catalog. `?active=1` lists only active plans. */
export async function GET(req: NextRequest) {
  try {
    await requirePlatformSession();
    const activeOnly = req.nextUrl.searchParams.get("active") === "1";
    return NextResponse.json({ data: await listSubscriptionPlans({ activeOnly }) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const input = subscriptionPlanSchema.parse(await req.json());
    const plan = await createSubscriptionPlan({ platformUserId: platformUser.id }, input);
    return NextResponse.json({ data: plan }, { status: 201, headers: { "x-toast-success": "Plan created." } });
  } catch (error) {
    return handleApiError(error);
  }
}

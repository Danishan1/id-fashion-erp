import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { subscriptionPlanSchema } from "@/modules/platform/subscription.schema";
import { getSubscriptionPlan, updateSubscriptionPlan } from "@/modules/platform/subscription-plan.service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    return NextResponse.json({ data: await getSubscriptionPlan(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const { id } = await params;
    const input = subscriptionPlanSchema.parse(await req.json());
    const plan = await updateSubscriptionPlan({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json({ data: plan }, { headers: { "x-toast-success": "Plan saved." } });
  } catch (error) {
    return handleApiError(error);
  }
}

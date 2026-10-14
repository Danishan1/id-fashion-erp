import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { changePlanSchema } from "@/modules/platform/subscription.schema";
import { changeSubscriptionPlan } from "@/modules/platform/company-subscription.service";

/** Platform SaaS Phase 4: billing staff manage a company's subscription manually (DEC-03). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const { id } = await params;
    const input = changePlanSchema.parse(await req.json());
    const result = await changeSubscriptionPlan({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json({ data: result }, { headers: { "x-toast-success": "Plan changed." } });
  } catch (error) {
    return handleApiError(error);
  }
}

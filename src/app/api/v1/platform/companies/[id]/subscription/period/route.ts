import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { adjustPeriodSchema } from "@/modules/platform/subscription.schema";
import { adjustSubscriptionPeriod } from "@/modules/platform/company-subscription.service";

/** Platform SaaS Phase 4: billing staff manage a company's subscription manually (DEC-03). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const { id } = await params;
    const input = adjustPeriodSchema.parse(await req.json());
    const result = await adjustSubscriptionPeriod({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json({ data: result }, { headers: { "x-toast-success": "Subscription period updated." } });
  } catch (error) {
    return handleApiError(error);
  }
}

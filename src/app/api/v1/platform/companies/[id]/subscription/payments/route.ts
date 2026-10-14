import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { recordPaymentSchema } from "@/modules/platform/subscription.schema";
import { recordSubscriptionPayment } from "@/modules/platform/company-subscription.service";

/** Platform SaaS Phase 4: billing staff manage a company's subscription manually (DEC-03). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const { id } = await params;
    const input = recordPaymentSchema.parse(await req.json());
    const result = await recordSubscriptionPayment({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json({ data: result }, { status: 201, headers: { "x-toast-success": "Payment recorded and subscription renewed." } });
  } catch (error) {
    return handleApiError(error);
  }
}

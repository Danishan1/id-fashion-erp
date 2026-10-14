import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { couponSchema } from "@/modules/platform/coupon.schema";
import { createCoupon, listCoupons } from "@/modules/platform/coupon.service";

/** PLAT-026: coupons / offers. */
export async function GET() {
  try {
    await requirePlatformSession();
    return NextResponse.json({ data: await listCoupons() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const input = couponSchema.parse(await req.json());
    const coupon = await createCoupon({ platformUserId: platformUser.id }, input);
    return NextResponse.json({ data: coupon }, { status: 201, headers: { "x-toast-success": "Coupon created." } });
  } catch (error) {
    return handleApiError(error);
  }
}

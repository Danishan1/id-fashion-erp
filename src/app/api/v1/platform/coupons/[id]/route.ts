import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { couponSchema } from "@/modules/platform/coupon.schema";
import { getCoupon, updateCoupon } from "@/modules/platform/coupon.service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    return NextResponse.json({ data: await getCoupon(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "BILLING_ADMIN"]);
    const { id } = await params;
    const input = couponSchema.parse(await req.json());
    const coupon = await updateCoupon({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json({ data: coupon }, { headers: { "x-toast-success": "Coupon saved." } });
  } catch (error) {
    return handleApiError(error);
  }
}

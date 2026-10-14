import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { couponPreviewSchema } from "@/modules/platform/coupon.schema";
import { previewCoupon, previewTrialCoupon } from "@/modules/platform/coupon.service";

const trialPreviewSchema = z.object({ usage: z.literal("TRIAL"), code: z.string().trim().min(1), planId: z.string().uuid() });

/** PLAT-027: checks a coupon and shows what it would do, without using it. Read-only. */
export async function POST(req: NextRequest) {
  try {
    await requirePlatformSession();
    const body = await req.json();
    if (body?.usage === "TRIAL") {
      const input = trialPreviewSchema.parse(body);
      return NextResponse.json({ data: await previewTrialCoupon(input.code, input.planId) });
    }
    return NextResponse.json({ data: await previewCoupon(couponPreviewSchema.parse(body)) });
  } catch (error) {
    return handleApiError(error);
  }
}

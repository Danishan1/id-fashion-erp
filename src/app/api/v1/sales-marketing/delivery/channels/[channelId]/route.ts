import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { setCampaignChannelActive } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** PATCH { isActive: boolean } */
export const PATCH = salesMarketingRoute<{ channelId: string }>({ module: "marketing_delivery", action: "edit" }, async ({ req, actor, params }) => {
  const body = (await req.json().catch(() => ({}))) as { isActive?: unknown };
  if (typeof body.isActive !== "boolean") throw new BusinessRuleError("VALIDATION_ERROR", "isActive must be true or false.");
  return NextResponse.json({ data: await setCampaignChannelActive(actor, params.channelId, body.isActive) });
});

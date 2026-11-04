import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { z } from "zod";
import { setChannelActive } from "@/modules/sales-marketing/channels/sales-channel.service";

/** PATCH { isActive }: deactivate / reactivate (never delete). */
export const PATCH = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor, params }) => {
  const { isActive } = z.object({ isActive: z.boolean() }).strict().parse(await req.json());
  return NextResponse.json({ data: await setChannelActive(actor, params.id, isActive) });
});

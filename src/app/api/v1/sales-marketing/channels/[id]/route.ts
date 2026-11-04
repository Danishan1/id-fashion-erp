import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { updateChannel } from "@/modules/sales-marketing/channels/sales-channel.service";

export const PATCH = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await updateChannel(actor, params.id, await req.json()) }));

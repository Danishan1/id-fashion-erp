import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createChannel, listChannels } from "@/modules/sales-marketing/channels/sales-channel.service";

export const GET = salesMarketingRoute([{ module: "sales_marketing_settings", action: "view" }, { module: "sales_marketing", action: "view" }], async ({ req, actor }) => NextResponse.json({ data: await listChannels(actor, Object.fromEntries(req.nextUrl.searchParams)) }));

export const POST = salesMarketingRoute({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createChannel(actor, await req.json()) }, { status: 201 }));

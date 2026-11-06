import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getDocumentChannel, setDocumentChannel } from "@/modules/sales-marketing/channels/sales-channel.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "sales_marketing", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getDocumentChannel(actor, "ENQUIRY", params.id) }));

/** PATCH { salesChannelId, salesAgentId } — the service checks the edit permission. */
export const PATCH = salesMarketingRoute<P>({ module: "sales_marketing", action: "view" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await setDocumentChannel(actor, "ENQUIRY", params.id, await req.json()) })
);

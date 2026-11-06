import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getDocumentChannel, setDocumentChannel } from "@/modules/sales-marketing/channels/sales-channel.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "sales_quotations", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getDocumentChannel(actor, "QUOTATION", params.id) }));

/** PATCH { salesChannelId, salesAgentId } — the service checks the edit permission. */
export const PATCH = salesMarketingRoute<P>({ module: "sales_quotations", action: "view" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await setDocumentChannel(actor, "QUOTATION", params.id, await req.json()) })
);

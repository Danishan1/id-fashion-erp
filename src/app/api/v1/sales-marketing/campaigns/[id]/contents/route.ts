import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createCampaignContent, listCampaignContents } from "@/modules/sales-marketing/content/campaign-content.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await listCampaignContents(actor, params.id) });
});

/** POST { name, templateId, locale? }: campaign content (version 1 copied from the template). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "create" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await createCampaignContent(actor, params.id, await req.json()) }, { status: 201 });
});

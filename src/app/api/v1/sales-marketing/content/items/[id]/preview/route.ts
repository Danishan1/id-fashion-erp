import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { previewContent } from "@/modules/sales-marketing/content/campaign-content.service";

/** POST { versionId?, contactId? }: render with sample data or a CRM contact you can see. Sends nothing. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "view" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await previewContent(actor, params.id, await req.json().catch(() => ({}))) });
});

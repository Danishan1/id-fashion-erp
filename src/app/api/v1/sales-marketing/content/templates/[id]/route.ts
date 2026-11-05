import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getMarketingTemplate } from "@/modules/sales-marketing/content/marketing-template.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getMarketingTemplate(actor, params.id) });
});

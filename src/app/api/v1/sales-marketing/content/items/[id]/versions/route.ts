import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { saveContentVersion } from "@/modules/sales-marketing/content/campaign-content.service";

/** POST { subject?, body, providerMetadata?, assetVersionIds?, locale?, changeNote?, version }: a new version. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await saveContentVersion(actor, params.id, await req.json()) }, { status: 201 });
});

import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getAsset, updateAsset } from "@/modules/sales-marketing/content/asset.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getAsset(actor, params.id) });
});

/** PATCH: metadata (name, description, tags, alt text, usage notes, expiry, owner) with `version`. */
export const PATCH = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await updateAsset(actor, params.id, await req.json()) });
});

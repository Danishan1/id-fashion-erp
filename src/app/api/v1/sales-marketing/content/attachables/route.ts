import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { attachableAssets } from "@/modules/sales-marketing/content/asset.service";

/** GET: approved, active, unexpired library files that can be attached to email. */
export const GET = salesMarketingRoute({ module: "marketing_content", action: "view" }, async ({ actor }) => {
  return NextResponse.json({ data: await attachableAssets(actor) });
});

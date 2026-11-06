import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getModel, newVersion } from "@/modules/sales-marketing/attribution/attribution-model.service";

/** POST: a new draft version, copied from the latest. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_attribution", action: "view" }, async ({ actor, params }) => {
  await newVersion(actor, params.id);
  return NextResponse.json({ data: await getModel(actor, params.id) }, { status: 201 });
});

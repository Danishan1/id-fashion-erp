import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getModel, saveVersionRules } from "@/modules/sales-marketing/attribution/attribution-model.service";

/** PATCH: save a draft version's rules. */
export const PATCH = salesMarketingRoute<{ id: string; versionId: string }>({ module: "marketing_attribution", action: "edit" }, async ({ req, actor, params }) => {
  await saveVersionRules(actor, params.id, params.versionId, await req.json());
  return NextResponse.json({ data: await getModel(actor, params.id) });
});

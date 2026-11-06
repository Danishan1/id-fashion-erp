import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getModel, retireModel, setDefaultModel } from "@/modules/sales-marketing/attribution/attribution-model.service";

/** POST set-default | retire { reason } — the service checks the permission. */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "marketing_attribution", action: "view" }, async ({ req, actor, params }) => {
  const body = await req.json().catch(() => ({}));
  if (params.action === "set-default") await setDefaultModel(actor, params.id);
  else if (params.action === "retire") await retireModel(actor, params.id, body);
  else throw new BusinessRuleError("NOT_FOUND", "Unknown action.");
  return NextResponse.json({ data: await getModel(actor, params.id) });
});

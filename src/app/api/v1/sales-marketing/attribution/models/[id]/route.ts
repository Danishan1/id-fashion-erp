import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getModel, updateModelHeader } from "@/modules/sales-marketing/attribution/attribution-model.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "marketing_attribution", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getModel(actor, params.id) }));

/** PATCH { name, description, version }. */
export const PATCH = salesMarketingRoute<P>({ module: "marketing_attribution", action: "edit" }, async ({ req, actor, params }) => {
  await updateModelHeader(actor, params.id, await req.json());
  return NextResponse.json({ data: await getModel(actor, params.id) });
});

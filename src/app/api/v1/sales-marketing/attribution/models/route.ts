import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createModel, listModels } from "@/modules/sales-marketing/attribution/attribution-model.service";

/** GET ?all=1: attribution models (retired hidden unless asked). POST: header + version 1 draft. */
export const GET = salesMarketingRoute({ module: "marketing_attribution", action: "view" }, async ({ req, actor }) =>
  NextResponse.json({ data: await listModels(actor, { includeRetired: req.nextUrl.searchParams.get("all") === "1" }) })
);

export const POST = salesMarketingRoute({ module: "marketing_attribution", action: "create" }, async ({ req, actor }) => NextResponse.json({ data: await createModel(actor, await req.json()) }, { status: 201 }));

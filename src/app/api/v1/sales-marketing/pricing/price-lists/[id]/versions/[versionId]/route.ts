import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { saveDraftVersion } from "@/modules/sales-marketing/pricing/price-list.service";

/** PUT: save a draft version (dates, note, all prices; with the `version` loaded). */
export const PUT = salesMarketingRoute<{ id: string; versionId: string }>({ module: "sales_pricing", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await saveDraftVersion(actor, params.id, params.versionId, await req.json()) })
);

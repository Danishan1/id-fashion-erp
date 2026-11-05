import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { startNewVersion } from "@/modules/sales-marketing/pricing/price-list.service";

/** POST: start a new draft version (copy of the latest approved one). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_pricing", action: "edit" }, async ({ actor, params }) =>
  NextResponse.json({ data: await startNewVersion(actor, params.id) }, { status: 201 })
);

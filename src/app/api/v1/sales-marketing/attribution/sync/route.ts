import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { syncAttributionSources } from "@/modules/sales-marketing/attribution/attribution-sync.service";

/** POST: read new / changed records into touchpoints and conversions now (incremental, idempotent). */
export const POST = salesMarketingRoute({ module: "marketing_attribution", action: "edit" }, async ({ actor }) => NextResponse.json({ data: await syncAttributionSources(actor.companyId) }));

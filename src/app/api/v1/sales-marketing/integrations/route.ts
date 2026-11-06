import { NextResponse } from "next/server";
import { listIntegrations } from "@/modules/sales-marketing/integrations/integrations.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 16 — GET the integration registry (refreshed from the underlying resources). */
export const GET = salesMarketingRoute({ module: "sales_integrations", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listIntegrations(actor) }));

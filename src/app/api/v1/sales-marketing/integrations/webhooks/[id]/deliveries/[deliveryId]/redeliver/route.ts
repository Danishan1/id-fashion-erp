import { NextResponse } from "next/server";
import { redeliverSm } from "@/modules/sales-marketing/integrations/sm-webhooks.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Replay a finished delivery (same Idempotency-Key) — sales_integrations.approve. */
export const POST = salesMarketingRoute<{ id: string; deliveryId: string }>({ module: "sales_integrations", action: "approve" }, async ({ actor, params }) => NextResponse.json({ data: await redeliverSm(actor, params.id, params.deliveryId) }));

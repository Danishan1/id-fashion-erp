import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { redeliver } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

/** Queues a finished delivery to be sent again (same event id and Idempotency-Key). */
export const POST = crmRoute<{ id: string; deliveryId: string }>({ module: "crm_settings", action: "edit" }, async ({ params, actor }) =>
  NextResponse.json({ data: await redeliver(actor, params.id, params.deliveryId) })
);

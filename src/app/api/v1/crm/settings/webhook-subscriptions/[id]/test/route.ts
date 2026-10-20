import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { sendTestDelivery } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

/** Body: { eventType? }. Sends a signed sample event (`test: true`, synthetic ids) now; never retried. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ data: await sendTestDelivery(actor, params.id, body ?? {}) });
});

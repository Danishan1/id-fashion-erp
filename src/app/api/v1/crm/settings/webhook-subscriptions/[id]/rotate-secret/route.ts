import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { rotateSubscriptionSecret } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

/** Body: { version }. New signing secret, shown ONCE in this response; the old one stops working immediately. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await rotateSubscriptionSecret(actor, params.id, await req.json()) }, { headers: { "Cache-Control": "no-store" } })
);

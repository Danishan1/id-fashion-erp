import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listWebhookEvents } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

/** The events a subscription can receive — the CRM event registry. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async () => NextResponse.json({ data: listWebhookEvents() }));

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { rotateWebhookSecret } from "@/modules/crm/capture/crm-webhooks.service";

/** New signing secret (shown once); the old one stops working immediately. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ params, actor }) =>
  NextResponse.json({ data: await rotateWebhookSecret(actor, params.id) }, { headers: { "Cache-Control": "no-store" } })
);

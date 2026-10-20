import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createSubscription, listSubscriptions } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

/** Phase 22 — outgoing webhook subscriptions. Lists never include the signing secret (only "configured"). */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) =>
  NextResponse.json({ data: await listSubscriptions(actor) }, { headers: { "Cache-Control": "no-store" } })
);

/** The generated signing secret is in this response ONCE (`secretOnce`); only an encrypted copy is stored. */
export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createSubscription(actor, await req.json()) }, { status: 201, headers: { "Cache-Control": "no-store" } })
);

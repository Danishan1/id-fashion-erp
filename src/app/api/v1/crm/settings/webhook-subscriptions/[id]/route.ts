import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteSubscription, getSubscription, updateSubscription } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

const noStore = { "Cache-Control": "no-store" };

export const GET = crmRoute<{ id: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) =>
  NextResponse.json({ data: await getSubscription(actor, params.id) }, { headers: noStore })
);

/** Body: { version, name?, description?, url?, eventTypes?, isActive? } — the secret can't be read or set here (use rotate-secret). */
export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateSubscription(actor, params.id, await req.json()) }, { headers: noStore })
);

export const DELETE = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ params, actor }) =>
  NextResponse.json({ data: await deleteSubscription(actor, params.id) })
);

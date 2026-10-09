import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listLeadProviderAdapters } from "@/modules/crm/capture/providers/registry";
import { createWebhook, listWebhooks } from "@/modules/crm/capture/crm-webhooks.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) =>
  NextResponse.json({ data: await listWebhooks(actor), meta: { providers: listLeadProviderAdapters() } })
);

/** Returns the signing secret ONCE (`secret`). */
export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createWebhook(actor, await req.json()) }, { status: 201, headers: { "Cache-Control": "no-store" } })
);

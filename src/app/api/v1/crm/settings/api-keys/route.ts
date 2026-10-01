import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createApiKey, listApiKeys } from "@/modules/crm/capture/crm-api-keys.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listApiKeys(actor) }));

/** Returns the full key ONCE (`key`); only a hash is stored. */
export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createApiKey(actor, await req.json()) }, { status: 201, headers: { "Cache-Control": "no-store" } })
);

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateWebhook } from "@/modules/crm/capture/crm-webhooks.service";

export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateWebhook(actor, params.id, await req.json()) })
);

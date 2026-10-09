import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateLeadSource } from "@/modules/crm/settings/crm-settings.service";

export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateLeadSource(actor, params.id, await req.json()) })
);

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateLeadStatus } from "@/modules/crm/settings/crm-settings.service";

export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateLeadStatus(actor, params.id, await req.json()) })
);

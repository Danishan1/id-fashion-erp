import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createOptionValue, listOptionValues } from "@/modules/crm/settings/crm-settings.service";

/** Department / designation / relationship-role suggestion lists. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listOptionValues(actor.companyId) }));

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createOptionValue(actor, await req.json()) }, { status: 201 }));

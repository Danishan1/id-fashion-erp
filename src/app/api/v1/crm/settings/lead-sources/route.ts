import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createLeadSource, listLeadSources } from "@/modules/crm/settings/crm-settings.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listLeadSources(actor.companyId) }));

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createLeadSource(actor, await req.json()) }, { status: 201 })
);

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createLeadStatus, listLeadStatuses } from "@/modules/crm/settings/crm-settings.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listLeadStatuses(actor.companyId) }));

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createLeadStatus(actor, await req.json()) }, { status: 201 })
);

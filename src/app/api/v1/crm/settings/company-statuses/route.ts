import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createCompanyStatus, listCompanyStatuses } from "@/modules/crm/settings/crm-settings.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listCompanyStatuses(actor.companyId) }));

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createCompanyStatus(actor, await req.json()) }, { status: 201 }));

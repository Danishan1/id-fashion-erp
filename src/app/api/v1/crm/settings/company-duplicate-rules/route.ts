import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCompanyDuplicateRules, updateCompanyDuplicateRules } from "@/modules/crm/settings/crm-settings.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await getCompanyDuplicateRules(actor.companyId) }));

/** Body: { rules: [{ rule: "NAME" | "LEGAL_NAME" | "WEBSITE" | "EMAIL" | "PHONE", action: "WARN" | "BLOCK" | "FLAG" | "OFF" }] } */
export const PUT = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await updateCompanyDuplicateRules(actor, await req.json()) }));

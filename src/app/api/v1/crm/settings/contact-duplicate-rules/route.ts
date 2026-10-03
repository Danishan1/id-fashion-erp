import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getContactDuplicateRules, updateContactDuplicateRules } from "@/modules/crm/settings/crm-settings.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await getContactDuplicateRules(actor.companyId) }));

/** Body: { rules: [{ rule: "EMAIL" | "PHONE" | "MOBILE" | "WHATSAPP" | "NAME_AND_COMPANY" | "NAME_AND_EMAIL", action: "WARN" | "BLOCK" | "FLAG" | "OFF" }] } */
export const PUT = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await updateContactDuplicateRules(actor, await req.json()) }));

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getLeadDuplicateRules, updateLeadDuplicateRules } from "@/modules/crm/settings/crm-settings.service";

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await getLeadDuplicateRules(actor.companyId) }));

/** Body: { rules: [{ rule: "EMAIL" | "PHONE" | "COMPANY_AND_EMAIL" | "COMPANY_AND_PHONE", action: "WARN" | "BLOCK" | "OFF" }] } */
export const PUT = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await updateLeadDuplicateRules(actor, await req.json()) })
);

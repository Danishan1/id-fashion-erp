import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { reorderCompanyStatuses } from "@/modules/crm/settings/crm-settings.service";

/** Body: { ids: [...every status id in the new order] }. */
export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await reorderCompanyStatuses(actor, await req.json()) }));

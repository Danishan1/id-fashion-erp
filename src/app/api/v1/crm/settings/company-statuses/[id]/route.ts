import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateCompanyStatus } from "@/modules/crm/settings/crm-settings.service";

/** Rename, recolour, (de)activate or make default. Statuses are never deleted. */
export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await updateCompanyStatus(actor, params.id, await req.json()) }));

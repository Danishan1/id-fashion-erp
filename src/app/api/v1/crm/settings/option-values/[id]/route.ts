import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateOptionValue } from "@/modules/crm/settings/crm-settings.service";

/** Rename, reorder or (de)activate a suggestion. Values already saved on contacts are never changed. */
export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await updateOptionValue(actor, params.id, await req.json()) }));

import { NextResponse } from "next/server";
import { updateChannel } from "@/modules/crm/conversations/crm-channels.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** PATCH { version, name?, address?, config?, defaultAssigneeUserId?, status? } */
export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await updateChannel(actor, params.id, await req.json()) }));

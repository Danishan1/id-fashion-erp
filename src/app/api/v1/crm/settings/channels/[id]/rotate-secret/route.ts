import { NextResponse } from "next/server";
import { rotateChannelSecret } from "@/modules/crm/conversations/crm-channels.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** New webhook signing secret (shown once); the old one stops working immediately. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ params, actor }) => NextResponse.json({ data: await rotateChannelSecret(actor, params.id) }));

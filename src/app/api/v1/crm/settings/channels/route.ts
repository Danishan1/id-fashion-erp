import { NextResponse } from "next/server";
import { channelSettingsMeta, createChannel, listChannels } from "@/modules/crm/conversations/crm-channels.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Conversation channels (CRM Settings). The signing secret is only in the POST response, once. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listChannels(actor), meta: channelSettingsMeta() }));

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createChannel(actor, await req.json()) }, { status: 201 }));

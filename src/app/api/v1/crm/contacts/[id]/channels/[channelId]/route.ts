import { NextResponse } from "next/server";
import { removeContactChannel } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

export const DELETE = crmRoute<{ id: string; channelId: string }>("edit", async ({ params, actor }) => {
  await removeContactChannel(actor, params.id, params.channelId);
  return NextResponse.json({ data: { id: params.channelId } });
});

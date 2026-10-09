import { NextResponse } from "next/server";
import { addContactChannel } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { channelType: "EMAIL" | "PHONE" | "MOBILE" | "WHATSAPP" | "LINKEDIN" | "WEBSITE" | …, value, label? }. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await addContactChannel(actor, params.id, await req.json()) }, { status: 201 }));

import { NextResponse } from "next/server";
import { setContactability } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { channel: "ALL" | "EMAIL" | "PHONE" | "SMS" | "WHATSAPP", status, reason (required unless ALLOWED), source? }. */
export const PUT = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await setContactability(actor, params.id, await req.json()) }));

import { NextResponse } from "next/server";
import { z } from "zod";
import { canContactContact } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

const channel = z.enum(["EMAIL", "PHONE", "SMS", "WHATSAPP"]);

/** ?channel=EMAIL|PHONE|SMS|WHATSAPP → { allowed, status, decidedBy, reason }. The check later sending features use. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) =>
  NextResponse.json({ data: await canContactContact(actor, params.id, channel.parse(req.nextUrl.searchParams.get("channel"))) })
);

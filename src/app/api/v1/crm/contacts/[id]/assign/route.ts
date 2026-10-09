import { NextResponse } from "next/server";
import { assignContact } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { ownerUserId: uuid | null, version? }. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await assignContact(actor, params.id, await req.json()) }));

import { NextResponse } from "next/server";
import { addContactAddress } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { addressType, label?, line1, line2?, city?, state?, postalCode?, country?, isPrimary? }. The first address is primary. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await addContactAddress(actor, params.id, await req.json()) }, { status: 201 }));

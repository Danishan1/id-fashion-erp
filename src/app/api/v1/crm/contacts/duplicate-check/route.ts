import { NextResponse } from "next/server";
import { checkContactDuplicates } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Live duplicate check for the contact form, using the same rules as save. */
export const POST = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await checkContactDuplicates(actor, await req.json()) }));

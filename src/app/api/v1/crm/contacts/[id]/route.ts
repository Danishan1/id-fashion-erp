import { NextResponse } from "next/server";
import { getContact, updateContact } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getContact(actor, params.id) }));

/** Partial update; body must include the `version` last read (409 RECORD_VERSION_CONFLICT if stale). */
export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateContact(actor, params.id, await req.json()) }));

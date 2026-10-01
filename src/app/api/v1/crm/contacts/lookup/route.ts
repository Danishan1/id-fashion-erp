import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { searchCrmContacts } from "@/modules/crm/contacts/crm-contacts.service";

/** Minimal contact lookup for linking (full Contacts module: Phase 04). */
export const GET = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await searchCrmContacts(actor, req.nextUrl.searchParams.get("search") ?? undefined) }));

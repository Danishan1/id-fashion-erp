import { NextResponse } from "next/server";
import { getContactRelated } from "@/modules/crm/contacts/contact-related.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Linked leads and opportunities (visible to the caller) and the sections that arrive in later phases. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getContactRelated(actor, params.id) }));

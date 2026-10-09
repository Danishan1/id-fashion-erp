import { NextResponse } from "next/server";
import { getContactErpReferences } from "@/modules/crm/contacts/contact-related.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * Read-only references to ERP documents of the contact's customer (via its
 * CRM company). Each section is included only when the caller has that
 * ERP module's view permission, and follows their branch access.
 */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getContactErpReferences(actor, params.id) }));

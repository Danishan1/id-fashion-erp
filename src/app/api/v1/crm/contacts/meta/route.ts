import { NextResponse } from "next/server";
import { getContactFormMeta } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Sources, contact custom fields, department/designation/role suggestions and whether ERP customers can be picked. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await getContactFormMeta(actor) }));

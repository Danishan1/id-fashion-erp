import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { addCompanyAddress } from "@/modules/crm/companies/crm-companies.service";

/** Body: { addressType, label?, line1, line2?, city?, state?, postalCode?, country?, isPrimary? }. The first address is primary. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await addCompanyAddress(actor, params.id, await req.json()) }, { status: 201 }));

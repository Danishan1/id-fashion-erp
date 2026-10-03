import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { assignCompany } from "@/modules/crm/companies/crm-companies.service";

/** Body: { ownerUserId: uuid | null, version? }. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await assignCompany(actor, params.id, await req.json()) }));

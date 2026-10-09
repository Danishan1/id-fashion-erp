import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { dismissCompanyDuplicateFlag } from "@/modules/crm/companies/crm-companies.service";

/** "Not a duplicate": clears the possible-duplicate flag left by a FLAG rule. */
export const POST = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await dismissCompanyDuplicateFlag(actor, params.id) }));

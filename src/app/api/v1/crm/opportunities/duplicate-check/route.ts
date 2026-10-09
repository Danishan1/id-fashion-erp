import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { checkOpportunityDuplicates } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Live "possible duplicate" check for the form (warning only — never blocks). */
export const POST = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await checkOpportunityDuplicates(actor, await req.json()) }));

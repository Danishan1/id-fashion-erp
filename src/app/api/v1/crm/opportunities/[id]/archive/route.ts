import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { archiveOpportunity } from "@/modules/crm/opportunities/crm-opportunities.service";

export const POST = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await archiveOpportunity(actor, params.id) }));

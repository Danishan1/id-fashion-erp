import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeOpportunityStatus } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { status: OPEN | WON | LOST | ABANDONED, reason?, version? } — closing stores closed_at; closed → Open reopens. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await changeOpportunityStatus(actor, params.id, await req.json()) }));

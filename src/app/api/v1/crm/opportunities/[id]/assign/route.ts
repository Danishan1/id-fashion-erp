import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { assignOpportunity } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { ownerUserId | null, version? }. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await assignOpportunity(actor, params.id, await req.json()) }));

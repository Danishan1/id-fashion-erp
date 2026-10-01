import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createOpportunityFromLead } from "@/modules/crm/leads/lead.service";

export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  const data = await createOpportunityFromLead(actor, params.id, await req.json());
  return NextResponse.json({ data }, { status: 201 });
});

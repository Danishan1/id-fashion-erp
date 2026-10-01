import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeLeadStatus } from "@/modules/crm/leads/lead.service";

export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  const data = await changeLeadStatus(actor, params.id, await req.json());
  return NextResponse.json({ data }, { status: 200 });
});

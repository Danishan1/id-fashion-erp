import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCrmEventById } from "@/modules/crm/core/crm-events.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => {
  const data = await getCrmEventById(actor.companyId, params.id);
  return NextResponse.json({ data });
});

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { archiveLead } from "@/modules/crm/leads/lead.service";

export const POST = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await archiveLead(actor, params.id) }));

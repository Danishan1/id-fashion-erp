import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { checkLeadDuplicates } from "@/modules/crm/leads/lead.service";

/** Live duplicate check for the lead form, using the same rules as save. */
export const POST = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await checkLeadDuplicates(actor, await req.json()) }));

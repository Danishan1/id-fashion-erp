import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getLeadFormMeta } from "@/modules/crm/leads/lead.service";

/** Statuses, sources, custom-field definitions and base currency for lead forms and filters. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await getLeadFormMeta(actor) }));

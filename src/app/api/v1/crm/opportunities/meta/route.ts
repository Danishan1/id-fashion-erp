import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getOpportunityFormMeta } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Pipelines with stages, statuses, sources, opportunity custom fields and close-reason suggestions. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await getOpportunityFormMeta(actor) }));

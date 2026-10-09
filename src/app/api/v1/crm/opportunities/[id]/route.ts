import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getOpportunity, updateOpportunity } from "@/modules/crm/opportunities/crm-opportunities.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getOpportunity(actor, params.id) }));

/** Partial update of an open opportunity; body must include the `version` last read (409 RECORD_VERSION_CONFLICT if stale). */
export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateOpportunity(actor, params.id, await req.json()) }));

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getLead, updateLead } from "@/modules/crm/leads/lead.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getLead(actor, params.id) }));

/** Partial update; body must include the `version` last read (409 RECORD_VERSION_CONFLICT if stale). */
export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateLead(actor, params.id, await req.json()) }));

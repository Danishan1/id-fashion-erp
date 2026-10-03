import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCompany, updateCompany } from "@/modules/crm/companies/crm-companies.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getCompany(actor, params.id) }));

/** Partial update; body must include the `version` last read (409 RECORD_VERSION_CONFLICT if stale). */
export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateCompany(actor, params.id, await req.json()) }));

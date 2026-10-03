import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listCompanyOpportunities, relatedPageSchema } from "@/modules/crm/companies/company-relations.service";

/** Paged opportunities of the company (pipeline / stage arrive with Phase 06/07). */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json(await listCompanyOpportunities(actor, params.id, relatedPageSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));

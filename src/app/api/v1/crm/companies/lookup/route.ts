import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { searchCrmCompanies } from "@/modules/crm/companies/crm-companies.service";

/** Minimal company lookup for linking (full Companies module: Phase 05). */
export const GET = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await searchCrmCompanies(actor, req.nextUrl.searchParams.get("search") ?? undefined) }));

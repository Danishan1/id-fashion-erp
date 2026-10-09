import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { searchCrmCompanies } from "@/modules/crm/companies/crm-companies.service";

/** Company lookup for linking pickers (active, unmerged companies visible to the caller). ?search=, ?limit= (≤200, default 20). */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 20));
  return NextResponse.json({ data: await searchCrmCompanies(actor, sp.get("search") ?? undefined, limit) });
});

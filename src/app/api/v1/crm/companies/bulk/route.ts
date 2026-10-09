import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { bulkCompanyAction } from "@/modules/crm/companies/crm-companies.service";

/** Body: { action: "assign" | "status" | "addTags" | "removeTags" | "archive", ids: [...≤500], ... }. Returns { requested, updated, skipped[] }. */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await bulkCompanyAction(actor, await req.json()) }));

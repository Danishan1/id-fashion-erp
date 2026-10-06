import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { bulkOpportunityAction } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { action: "assign" | "stage" | "status" | "addTags" | "removeTags" | "archive", ids: [...≤500], ... }. Returns { requested, updated, skipped[] } (+ blocked[] with missing fields for "stage"). */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await bulkOpportunityAction(actor, await req.json()) }));

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { bulkLeadAction } from "@/modules/crm/leads/lead.service";

/** Body: { action: "assign" | "status" | "addTags" | "removeTags" | "archive", ids: [...≤500], ... }. Returns { requested, updated, skipped[] }. */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await bulkLeadAction(actor, await req.json()) }));

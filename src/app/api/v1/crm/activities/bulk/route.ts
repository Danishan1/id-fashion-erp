import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { bulkActivityAction } from "@/modules/crm/activities/crm-activities.service";

/** Body: { action: "assign" | "complete" | "reschedule" | "priority" | "cancel", ids: [...≤200], … }. Each record is validated on its own; returns { requested, updated, skipped[] }. */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await bulkActivityAction(actor, await req.json()) }));

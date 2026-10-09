import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { assignActivity } from "@/modules/crm/activities/crm-activities.service";

/** Body: { version?, assignedToUserId | null } — an active ERP user with CRM access; the assignee is notified. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await assignActivity(actor, params.id, await req.json().catch(() => ({}))) }));

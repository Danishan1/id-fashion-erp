import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { rescheduleActivity } from "@/modules/crm/activities/crm-activities.service";

/** Body: { version?, dueDate, dueTime?, endTime?, reminderMinutes?, reason? } — the original due date is kept. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await rescheduleActivity(actor, params.id, await req.json().catch(() => ({}))) }));

import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { completeActivity } from "@/modules/crm/activities/crm-activities.service";

/** Body: { version?, outcome?, note?, completedDate?, completedTime? } — idempotent when already completed. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await completeActivity(actor, params.id, await req.json().catch(() => ({}))) }));

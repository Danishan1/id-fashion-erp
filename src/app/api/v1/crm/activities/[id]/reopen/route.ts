import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { reopenActivity } from "@/modules/crm/activities/crm-activities.service";

/** Body: { version?, reason? } — completed / cancelled → pending. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await reopenActivity(actor, params.id, await req.json().catch(() => ({}))) }));

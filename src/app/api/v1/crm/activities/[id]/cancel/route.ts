import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { cancelActivity } from "@/modules/crm/activities/crm-activities.service";

/** Body: { version?, reason? }. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await cancelActivity(actor, params.id, await req.json().catch(() => ({}))) }));

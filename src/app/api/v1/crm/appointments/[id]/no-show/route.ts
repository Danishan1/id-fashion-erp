import { NextResponse } from "next/server";
import { markNoShow } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version?, reason? } → No show (only after the start time); idempotent. Emits appointment.no_show. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await markNoShow(actor, params.id, await req.json().catch(() => ({}))) }));

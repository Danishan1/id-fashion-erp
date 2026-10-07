import { NextResponse } from "next/server";
import { completeAppointment } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version?, outcome?, note? } → Completed; idempotent. Emits appointment.completed. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await completeAppointment(actor, params.id, await req.json().catch(() => ({}))) }));

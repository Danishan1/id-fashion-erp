import { NextResponse } from "next/server";
import { confirmAppointment } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version?, reason? } — Scheduled / Rescheduled → Confirmed; idempotent. Emits appointment.confirmed. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await confirmAppointment(actor, params.id, await req.json().catch(() => ({}))) }));
